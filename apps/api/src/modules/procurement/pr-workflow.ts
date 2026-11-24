import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { ProductUsage } from '../master-data/product-usage';
import { SalesContractFacade } from '../sales-contracts/sales-contracts.service';
import { ActionContext, assertActionContext, WorkflowStep } from '../workflow/action-context';
import * as wf from '../workflow/workflow';
import { currentGrant, eligible, PrRoute } from './pr-eligibility';

export type { PrRoute } from './pr-eligibility';
export type PrAction = 'approve' | 'receive' | 'reject' | 'recall' | 'cancel';
type PrHeader = wf.DocHeader & { sales_contract_id: number; creator_route: PrRoute; approval_round: number };
const pending = ['WAITING_FOR_APPROVE', 'WAITING_FOR_RECEIPT'];
export type PrSubmission = ActionContext & { approverId: number; receiverId: number };
export interface PrSelection { approverId?: number | null; receiverId?: number | null }

export async function validateSelection(m: EntityManager, route: PrRoute, creatorId: number, selection: PrSelection) {
  const approver = selection.approverId == null ? undefined : await eligible(m, route, selection.approverId, creatorId);
  const receiver = selection.receiverId == null ? undefined : await eligible(m, 'RECEIPT', selection.receiverId, creatorId);
  if ((selection.approverId != null && !approver) || (selection.receiverId != null && !receiver)) {
    throw new wf.BusinessError('PR_CANDIDATE_NOT_ELIGIBLE', 'Choose eligible candidates or contact Admin');
  }
  return { approver, receiver };
}

export function currentStep(status: string): WorkflowStep {
  if (status === 'WAITING_FOR_APPROVE') return 'APPROVAL';
  if (status === 'WAITING_FOR_RECEIPT') return 'RECEIPT';
  return status === 'DRAFT' || status === 'REJECTED' ? 'CREATE' : 'CLOSED';
}

async function assertCreatorGrant(m: EntityManager, doc: PrHeader, user: CurrentUser) {
  wf.assertCreator(doc, user);
  if (!(await currentGrant(m, user.id, 'PR.CREATE')).length) throw new ForbiddenException('Missing PR.CREATE');
}

export async function creatorRoute(m: EntityManager, user: CurrentUser, contractId: number, expected?: PrRoute): Promise<PrRoute> {
  const contract = await SalesContractFacade.sourceContract(m, contractId);
  const routes: PrRoute[] = [];
  if (contract?.responsibleSalesUserId === user.id) routes.push('SALES');
  if (contract?.responsiblePmUserId === user.id) routes.push('PM');
  if (routes.length && contract?.status !== 'ACTIVE') {
    throw new wf.BusinessError('SALES_CONTRACT_NOT_ACTIVE', 'Only active contracts can source a PR');
  }
  if (expected && routes.includes(expected)) return expected;
  if (!expected && routes.length === 1) return routes[0];
  if (!expected && routes.length > 1) throw new wf.BusinessError('PR_ROUTE_REQUIRED', 'Select the Sales or PM route');
  throw new ForbiddenException('The contract is outside your PR creation scope');
}

async function history(m: EntityManager, doc: PrHeader, action: string, userId: number, next: string, round: number, reason?: string) {
  await wf.record(m, 'PR', doc.id, action, userId, reason, {
    previousStatus: doc.approval_status, nextStatus: next, round,
  });
}

async function notify(m: EntityManager, id: number, recipients: number[], action: string, round: number, reason?: string) {
  await m.query(`INSERT INTO pr_notifications (pr_id, recipient_id, action, round, reason)
    SELECT $1, id, $3, $4, $5 FROM unnest($2::int[]) AS recipients(id) GROUP BY id`, [id, recipients, action, round, reason ?? null]);
}

export async function submit(m: EntityManager, id: number, user: CurrentUser, dto: PrSubmission) {
  const [source] = await m.query('SELECT sales_contract_id FROM purchase_requisitions WHERE id = $1', [id]);
  if (source) await SalesContractFacade.sourceContract(m, source.sales_contract_id);
  const doc = await lock(m, id);
  await assertCreatorGrant(m, doc, user);
  assertActionContext(doc, doc.approval_round, currentStep(doc.approval_status), dto);
  wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
  await creatorRoute(m, user, doc.sales_contract_id, doc.creator_route);
  const lines: { product_id: number }[] = await m.query(
    'SELECT product_id FROM purchase_requisition_lines WHERE purchase_requisition_id = $1', [id],
  );
  if (!lines.length) throw new wf.BusinessError('PR_LINES_REQUIRED', 'Add at least one valid line before submitting');
  await ProductUsage.assertActiveProducts(m, lines.map(line => line.product_id));
  const { approver, receiver } = await validateSelection(m, doc.creator_route, user.id, dto);
  if (!approver || !receiver) throw new wf.BusinessError('PR_CANDIDATE_NOT_ELIGIBLE', 'Choose eligible candidates or contact Admin');
  const round = doc.approval_round + 1;
  await m.query(`INSERT INTO pr_workflow_nodes (pr_id, round, step, department, assignee_id)
    VALUES ($1, $2, 'APPROVAL', $3, $4), ($1, $2, 'RECEIPT', $5, $6)`,
    [id, round, approver.role, dto.approverId, receiver.role, dto.receiverId]);
  await wf.setStatus(m, 'PR', doc, 'WAITING_FOR_APPROVE',
    ', assigned_approver_id = $3, approval_round = $4, draft_approver_id = $3, draft_receiver_id = $5',
    [dto.approverId, round, dto.receiverId]);
  await history(m, doc, round === 1 ? 'SUBMIT' : 'RESUBMIT', user.id, 'WAITING_FOR_APPROVE', round);
  await notify(m, id, [dto.approverId], 'SUBMIT', round);
}

export async function decide(m: EntityManager, doc: PrHeader, user: CurrentUser, action: PrAction, reason: string | undefined,
  hasChildren: () => Promise<boolean>, context: ActionContext) {
  const round = doc.approval_round;
  const step = currentStep(doc.approval_status);
  assertActionContext(doc, round, step, context);
  if ((action === 'reject' || action === 'recall' || (action === 'cancel' && doc.approval_status === 'DONE')) && !reason?.trim()) {
    throw new wf.BusinessError('REASON_REQUIRED', 'A reason is required');
  }
  if (action === 'recall' || action === 'cancel') {
    await assertCreatorGrant(m, doc, user);
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
  wf.assertStatus(doc, action === 'approve' ? ['WAITING_FOR_APPROVE'] : action === 'receive' ? ['WAITING_FOR_RECEIPT'] : pending);
  const nodes: { step: string; assignee_id: number; result: string | null }[] = await m.query(
    'SELECT step, assignee_id, result FROM pr_workflow_nodes WHERE pr_id = $1 AND round = $2 AND invalidated_at IS NULL', [doc.id, round]);
  const assignment = nodes.find(node => node.step === step && node.assignee_id === user.id && node.result === null);
  const pool = step === 'APPROVAL' ? doc.creator_route : 'RECEIPT';
  if (!assignment || !(await eligible(m, pool, user.id, doc.created_by))) {
    throw new ForbiddenException('You do not have active eligibility and assignment for this PR step');
  }
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
