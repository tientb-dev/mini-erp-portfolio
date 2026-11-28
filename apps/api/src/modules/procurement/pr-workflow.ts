import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { SalesContractFacade } from '../sales-contracts/sales-contracts.service';
import { ActionContext, assertActionContext, WorkflowStep } from '../workflow/action-context';
import * as wf from '../workflow/workflow';
import { assertPrReady } from './pr-commercial';
import { currentGrant, eligible, listCandidates, PrRoute } from './pr-eligibility';
import { assignPrTask, notifyPr, PrPendingStep, resolvePrTasks } from './pr-notifications';

export type { PrRoute } from './pr-eligibility';
export type PrAction = 'approve' | 'receive' | 'reject' | 'recall' | 'cancel';
export type PrHeader = wf.DocHeader & { sales_contract_id: number; creator_route: PrRoute; approval_round: number };
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

export async function creatorRoute(m: EntityManager, user: CurrentUser, contractId: number, expected?: PrRoute, lock = true): Promise<PrRoute> {
  const contract = await SalesContractFacade.sourceContract(m, contractId, lock);
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

export async function submit(m: EntityManager, id: number, user: CurrentUser, dto: PrSubmission) {
  const doc = await lock(m, id);
  await assertCreatorGrant(m, doc, user);
  assertActionContext(doc, doc.approval_round, currentStep(doc.approval_status), dto);
  wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
  await creatorRoute(m, user, doc.sales_contract_id, doc.creator_route);
  await assertPrReady(m, id);
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
  await assignPrTask(m, id, dto.approverId, round, 'APPROVAL');
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
      await resolvePrTasks(m, doc.id, round);
      const recipients = action === 'recall' ? [doc.assigned_approver_id].filter((id): id is number => id !== null)
        : nodes.map(node => node.assignee_id);
      await notifyPr(m, doc.id, recipients, action.toUpperCase(), round, reason);
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
  await resolvePrTasks(m, doc.id, round);
  await notifyPr(m, doc.id, [doc.created_by], event, round, reason);
  if (receiver) await assignPrTask(m, doc.id, receiver, round, 'RECEIPT');
}

/**
 * Reassignment paths (Business Rule, unchanged): the creator (PR.CREATE), a PR.REASSIGN holder, or the current receiver
 * (PR.RECEIVE). `scoped`: the user's permissions whose Data Scope matches this PR (OA3.3b); a path needs its own scope.
 */
export async function canReassign(m: EntityManager, doc: Pick<PrHeader, 'created_by' | 'approval_status' | 'assigned_approver_id'>,
  user: CurrentUser, checkLive: boolean, scoped: string[]) {
  if (!pending.includes(doc.approval_status) || !doc.assigned_approver_id) return false;
  const step = currentStep(doc.approval_status);
  const owns = doc.created_by === user.id;
  if (owns && scoped.includes('PR.CREATE') && (!checkLive || (await currentGrant(m, user.id, 'PR.CREATE')).length)) return true;
  if (scoped.includes('PR.REASSIGN') && (!checkLive || (await currentGrant(m, user.id, 'PR.REASSIGN')).length)) return true;
  if (step !== 'RECEIPT' || doc.assigned_approver_id !== user.id || !scoped.includes('PR.RECEIVE')) return false;
  return checkLive ? Boolean(await eligible(m, 'RECEIPT', user.id, doc.created_by))
    : (await listCandidates(m, 'RECEIPT', doc.created_by)).some(candidate => candidate.id === user.id);
}

async function pendingNode(m: EntityManager, doc: PrHeader, user: CurrentUser, scoped: string[], checkLive: boolean) {
  if (!(doc.created_by === user.id && scoped.includes('PR.CREATE')) && !scoped.includes('PR.REASSIGN')
    && !(currentStep(doc.approval_status) === 'RECEIPT' && doc.assigned_approver_id === user.id && scoped.includes('PR.RECEIVE'))) {
    throw new ForbiddenException('You cannot reassign this PR step');
  }
  wf.assertStatus(doc, pending);
  if (!(await canReassign(m, doc, user, checkLive, scoped))) throw new ForbiddenException('You cannot reassign this PR step');
  const step = currentStep(doc.approval_status) as PrPendingStep;
  const [node]: { assignee_id: number; fullName: string }[] = await m.query(
    `SELECT n.assignee_id, u.full_name AS "fullName" FROM pr_workflow_nodes n JOIN users u ON u.id = n.assignee_id
     WHERE n.pr_id = $1 AND n.round = $2 AND n.step = $3 AND n.result IS NULL AND n.invalidated_at IS NULL
       AND n.assignee_id = $4`, [doc.id, doc.approval_round, step, doc.assigned_approver_id],
  );
  if (!node) throw new wf.BusinessError('INVALID_STATUS', 'There is no active assignment', HttpStatus.CONFLICT);
  return { node, step, pool: step === 'APPROVAL' ? doc.creator_route : 'RECEIPT' as const };
}

export async function reassignmentCandidates(m: EntityManager, doc: PrHeader, user: CurrentUser, scoped: string[]) {
  const { node, pool } = await pendingNode(m, doc, user, scoped, false);
  const candidates = await listCandidates(m, pool, doc.created_by);
  return { current: { id: node.assignee_id, fullName: node.fullName }, candidates: candidates.filter(c => c.id !== node.assignee_id) };
}

export async function reassign(m: EntityManager, doc: PrHeader, user: CurrentUser, dto: ActionContext & { assigneeId: number; reason: string },
  scoped: string[]) {
  const { node, step, pool } = await pendingNode(m, doc, user, scoped, true);
  assertActionContext(doc, doc.approval_round, step, dto);
  const reason = dto.reason.trim();
  if (!reason) throw new wf.BusinessError('REASON_REQUIRED', 'A reason is required');
  if (node.assignee_id === dto.assigneeId) throw new wf.BusinessError('PR_SAME_ASSIGNEE', 'Select a different assignee');
  const next = await eligible(m, pool, dto.assigneeId, doc.created_by);
  if (!next) throw new wf.BusinessError('PR_CANDIDATE_NOT_ELIGIBLE', 'Choose an eligible replacement');
  await m.query(`UPDATE pr_workflow_nodes SET assignee_id = $4, department = $5 WHERE pr_id = $1 AND round = $2 AND step = $3`,
    [doc.id, doc.approval_round, step, dto.assigneeId, next.role]);
  await wf.setStatus(m, 'PR', doc, doc.approval_status, ', assigned_approver_id = $3', [dto.assigneeId]);
  await wf.record(m, 'PR', doc.id, 'REASSIGN', user.id, reason, {
    previousStatus: doc.approval_status, nextStatus: doc.approval_status, round: doc.approval_round,
    metadata: { step, from: { id: node.assignee_id, fullName: node.fullName }, to: { id: dto.assigneeId, fullName: next.fullName } },
  });
  await resolvePrTasks(m, doc.id, doc.approval_round);
  await notifyPr(m, doc.id, [node.assignee_id], 'REASSIGNED_AWAY', doc.approval_round, reason);
  await assignPrTask(m, doc.id, dto.assigneeId, doc.approval_round, step);
}

export function lock(m: EntityManager, id: number) {
  return wf.lockDocument(m, 'PR', id) as Promise<PrHeader>;
}
