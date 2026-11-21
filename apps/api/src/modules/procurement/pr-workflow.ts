import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { SalesContractFacade } from '../sales-contracts/sales-contracts.service';
import * as wf from '../workflow/workflow';

export type PrRoute = 'SALES' | 'PM';
type PrAction = 'approve' | 'reject' | 'recall' | 'cancel';
type PrHeader = wf.DocHeader & { sales_contract_id: number; creator_route: PrRoute; approval_round: number };
const pending = ['WAITING_FOR_APPROVE', 'WAITING_FOR_RECEIPT'];
const headRoles = { SALES: 'SALES_HEAD', PM: 'PM_HEAD' };
const stepPermission = { APPROVAL: 'PR.APPROVE', RECEIPT: 'PR.RECEIVE' };
type Assignment = { approver_id: number; receiver_id: number; receipt_role: string };

export async function creatorRoute(m: EntityManager, user: CurrentUser, contractId: number, expected?: PrRoute): Promise<PrRoute> {
  const contract = await SalesContractFacade.sourceContract(m, contractId);
  const routes: PrRoute[] = [];
  if (contract?.responsibleSalesUserId === user.id && user.roleCodes?.includes('SALES')) routes.push('SALES');
  if (contract?.responsiblePmUserId === user.id && user.roleCodes?.includes('PM')) routes.push('PM');
  if (expected && routes.includes(expected)) return expected;
  if (!expected && routes.length === 1) return routes[0];
  if (!expected && routes.length > 1) throw new wf.BusinessError('PR_ROUTE_REQUIRED', 'Select the Sales or PM route');
  throw new ForbiddenException('The contract is outside your PR creation scope');
}

async function eligible(m: EntityManager, id: number, role: string, permission: string) {
  const [row] = await m.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
      JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1 AND u.is_active AND r.code = $2 AND p.code = $3`,
    [id, role, permission],
  );
  return !!row;
}

async function validateAssignment(m: EntityManager, route: PrRoute, assignment: Assignment, creatorId?: number) {
  if (assignment.approver_id === creatorId || !(await eligible(m, assignment.approver_id, headRoles[route], 'PR.APPROVE'))) {
    throw new wf.BusinessError('PR_APPROVER_NOT_CONFIGURED', `Configure an eligible ${headRoles[route]} for this PR`);
  }
  if (assignment.receipt_role === 'ADMIN' || assignment.receiver_id === creatorId
      || !(await eligible(m, assignment.receiver_id, assignment.receipt_role, 'PR.RECEIVE'))) {
    throw new wf.BusinessError('PR_RECEIVER_NOT_CONFIGURED', 'Configure an eligible receiver for this PR');
  }
}

export async function configure(m: EntityManager, route: PrRoute, assignment: Assignment) {
  await validateAssignment(m, route, assignment);
  await m.query(`INSERT INTO pr_workflow_routes (route, approver_id, receiver_id, receipt_role) VALUES ($1, $2, $3, $4)
    ON CONFLICT (route) DO UPDATE SET approver_id = EXCLUDED.approver_id, receiver_id = EXCLUDED.receiver_id, receipt_role = EXCLUDED.receipt_role`,
    [route, assignment.approver_id, assignment.receiver_id, assignment.receipt_role]);
}

async function history(m: EntityManager, doc: PrHeader, action: string, userId: number, next: string, round: number, reason?: string) {
  await m.query(`INSERT INTO approval_histories
    (document_type, document_id, action, actor_id, reason, previous_status, next_status, approval_round)
    VALUES ('PR', $1, $2, $3, $4, $5, $6, $7)`, [doc.id, action, userId, reason ?? null, doc.approval_status, next, round]);
}

async function notify(m: EntityManager, id: number, recipients: number[], action: string, round: number, reason?: string) {
  await m.query(`INSERT INTO pr_notifications (pr_id, recipient_id, action, round, reason)
    SELECT $1, id, $3, $4, $5 FROM unnest($2::int[]) AS recipients(id) GROUP BY id`, [id, recipients, action, round, reason ?? null]);
}

export async function submit(m: EntityManager, id: number, user: CurrentUser) {
  const [source] = await m.query('SELECT sales_contract_id FROM purchase_requisitions WHERE id = $1', [id]);
  if (source) await SalesContractFacade.sourceContract(m, source.sales_contract_id);
  const doc = await lock(m, id);
  wf.assertCreator(doc, user);
  wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
  await creatorRoute(m, user, doc.sales_contract_id, doc.creator_route);
  const [assignment] = await m.query('SELECT * FROM pr_workflow_routes WHERE route = $1', [doc.creator_route]) as Assignment[];
  if (!assignment) throw new wf.BusinessError('PR_WORKFLOW_NOT_CONFIGURED', `Configure the approver and receiver for ${doc.creator_route}`);
  await validateAssignment(m, doc.creator_route, assignment, user.id);
  const round = doc.approval_round + 1;
  await m.query(`INSERT INTO pr_workflow_nodes (pr_id, round, step, department, assignee_id)
    VALUES ($1, $2, 'APPROVAL', $3, $4), ($1, $2, 'RECEIPT', $5, $6)`,
    [id, round, doc.creator_route, assignment.approver_id, assignment.receipt_role, assignment.receiver_id]);
  await wf.setStatus(m, 'PR', doc, 'WAITING_FOR_APPROVE', ', assigned_approver_id = $3, approval_round = $4', [assignment.approver_id, round]);
  await history(m, doc, round === 1 ? 'SUBMIT' : 'RESUBMIT', user.id, 'WAITING_FOR_APPROVE', round);
  await notify(m, id, [assignment.approver_id], 'SUBMIT', round);
}

export async function decide(m: EntityManager, doc: PrHeader, user: CurrentUser, action: PrAction, reason: string | undefined,
  hasChildren: () => Promise<boolean>, version?: number) {
  const round = doc.approval_round;
  if ((action === 'reject' || action === 'recall' || (action === 'cancel' && doc.approval_status === 'DONE')) && !reason?.trim()) {
    throw new wf.BusinessError('REASON_REQUIRED', 'A reason is required');
  }
  if (action === 'recall' || action === 'cancel') {
    wf.assertCreator(doc, user);
    if (version !== undefined) wf.assertVersion(doc, version);
    wf.assertStatus(doc, action === 'recall' ? pending : ['DRAFT', 'REJECTED', 'DONE']);
    if (doc.approval_status === 'DONE' && await hasChildren()) {
      throw new wf.BusinessError('HAS_ACTIVE_CHILD_DOCUMENTS', 'This PR has an active PO', HttpStatus.CONFLICT);
    }
    const next = action === 'recall' ? 'DRAFT' : 'CANCELED';
    if (action === 'recall' || doc.approval_status === 'DONE') {
      const nodes: { assignee_id: number }[] = await m.query(
        'SELECT assignee_id FROM pr_workflow_nodes WHERE pr_id = $1 AND round = $2', [doc.id, round]);
      await m.query('UPDATE pr_workflow_nodes SET invalidated_at = now() WHERE pr_id = $1 AND round = $2', [doc.id, round]);
      await notify(m, doc.id, nodes.map(node => node.assignee_id), action.toUpperCase(), round, reason);
    }
    await wf.setStatus(m, 'PR', doc, next, ', assigned_approver_id = NULL');
    await history(m, doc, action.toUpperCase(), user.id, next, round, reason);
    return;
  }
  if (!Object.values(stepPermission).some(permission => user.permissions.includes(permission))) {
    throw new ForbiddenException('Missing PR decision permission');
  }
  wf.assertStatus(doc, pending);
  const step = doc.approval_status === 'WAITING_FOR_APPROVE' ? 'APPROVAL' : 'RECEIPT';
  const nodes: { step: string; assignee_id: number; department: string }[] = await m.query(
    'SELECT step, assignee_id, department FROM pr_workflow_nodes WHERE pr_id = $1 AND round = $2 AND invalidated_at IS NULL', [doc.id, round]);
  const assignment = nodes.find(node => node.step === step && node.assignee_id === user.id);
  const role = step === 'APPROVAL' ? headRoles[doc.creator_route] : assignment?.department;
  if (!assignment || !role || !user.roleCodes?.includes(role) || !user.permissions.includes(stepPermission[step]) || doc.created_by === user.id) {
    throw new ForbiddenException('You do not have permission and assignment for this PR step');
  }
  if (version !== undefined) wf.assertVersion(doc, version);
  const next = action === 'reject' ? 'REJECTED' : step === 'APPROVAL' ? 'WAITING_FOR_RECEIPT' : 'DONE';
  const receiver = next === 'WAITING_FOR_RECEIPT' ? nodes.find(node => node.step === 'RECEIPT')!.assignee_id : null;
  await m.query(`UPDATE pr_workflow_nodes SET result = $4, actor_id = $5, acted_at = now()
    WHERE pr_id = $1 AND round = $2 AND step = $3`, [doc.id, round, step, action === 'reject' ? 'REJECTED' : 'APPROVED', user.id]);
  await wf.setStatus(m, 'PR', doc, next, ', assigned_approver_id = $3', [receiver]);
  const event = action === 'reject' ? 'REJECT' : step === 'RECEIPT' ? 'RECEIVE' : 'APPROVE';
  await history(m, doc, event, user.id, next, round, reason);
  await notify(m, doc.id, receiver ? [doc.created_by, receiver] : [doc.created_by], event, round, reason);
}

export function lock(m: EntityManager, id: number) {
  return wf.lockDocument(m, 'PR', id) as Promise<PrHeader>;
}
