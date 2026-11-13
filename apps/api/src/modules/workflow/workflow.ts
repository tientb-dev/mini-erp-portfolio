import { ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';

/** Business rule violation with a stable `code` (RFC 9457 extension, mapped by ProblemDetailsFilter). */
export class BusinessError extends HttpException {
  constructor(readonly code: string, detail: string, status = HttpStatus.UNPROCESSABLE_ENTITY) {
    super(detail, status);
  }
}

/** Document types that go through the one-level approval workflow; `table` is never user input. */
export const DOC_TYPES = {
  PR: { table: 'purchase_requisitions', prefix: 'PR', approvePermission: 'PR.APPROVE', warehouseScoped: false },
  PO: { table: 'purchase_orders', prefix: 'PO', approvePermission: 'PO.APPROVE', warehouseScoped: false },
  GRR: { table: 'goods_receipt_requests', prefix: 'GRR', approvePermission: 'GRR.APPROVE', warehouseScoped: true },
  GR: { table: 'goods_receipts', prefix: 'GR', approvePermission: 'GR.APPROVE', warehouseScoped: true },
  // GIR AVAILABLE_STOCK adds a Sales step before this (ADR-0010); the final approval is the warehouse manager's.
  GIR: { table: 'goods_issue_requests', prefix: 'GIR', approvePermission: 'GIR.APPROVE', warehouseScoped: true },
  GI: { table: 'goods_issues', prefix: 'GI', approvePermission: 'GI.APPROVE', warehouseScoped: true },
} as const;
export type DocType = keyof typeof DOC_TYPES;

export interface DocHeader {
  id: number;
  document_number: string;
  approval_status: string;
  created_by: number;
  assigned_approver_id: number | null;
  version: number;
  warehouse_id?: number;
}

/** `<PREFIX>-<YYYY>-<NNNNNN>`, one sequence per (type, year); gaps allowed, never reused (ADR-0011). */
export async function nextDocumentNumber(m: EntityManager, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await m.query(
    `INSERT INTO document_sequences (document_type, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (document_type, year) DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [prefix, year],
  );
  return `${prefix}-${year}-${String(row.last_value).padStart(6, '0')}`;
}

/** Locks the document header row for the rest of the transaction. */
export async function lockDocument(m: EntityManager, type: DocType, id: number): Promise<DocHeader> {
  const [doc] = await m.query(`SELECT * FROM ${DOC_TYPES[type].table} WHERE id = $1 FOR UPDATE`, [id]);
  if (!doc) throw new NotFoundException(`${type} ${id} not found`);
  return doc;
}

export function assertStatus(doc: DocHeader, allowed: string[]): void {
  if (!allowed.includes(doc.approval_status)) {
    throw new BusinessError('INVALID_STATUS', `${doc.document_number} is ${doc.approval_status}; expected ${allowed.join('/')}`, HttpStatus.CONFLICT);
  }
}

export function assertWarehouse(user: CurrentUser, warehouseId: number): void {
  if (!user.warehouseIds.includes(warehouseId)) throw new ForbiddenException('Warehouse is outside your scope');
}

export function assertCreator(doc: DocHeader, user: CurrentUser): void {
  if (doc.created_by !== user.id) throw new BusinessError('NOT_DOCUMENT_CREATOR', 'Only the creator can perform this action', HttpStatus.FORBIDDEN);
}

/** Optimistic concurrency for edits (03 §2: block overwriting stale data). */
export function assertVersion(doc: DocHeader, version: number): void {
  if (doc.version !== version) throw new BusinessError('STALE_VERSION', 'The document was changed by someone else; reload and retry', HttpStatus.CONFLICT);
}

export async function record(m: EntityManager, type: DocType, id: number, action: string, actorId: number, reason?: string) {
  await m.query(`INSERT INTO approval_histories (document_type, document_id, action, actor_id, reason) VALUES ($1, $2, $3, $4, $5)`, [
    type, id, action, actorId, reason ?? null,
  ]);
}

export async function setStatus(m: EntityManager, type: DocType, doc: DocHeader, status: string, extra = '', params: unknown[] = []) {
  await m.query(
    `UPDATE ${DOC_TYPES[type].table} SET approval_status = $2, version = version + 1, updated_at = now() ${extra} WHERE id = $1`,
    [doc.id, status, ...params],
  );
}

/** Users who may approve this document: permission + warehouse scope, never the creator (04 §3). */
export function eligibleApprovers(m: EntityManager, type: DocType, creatorId: number, warehouseId?: number) {
  const { approvePermission, warehouseScoped } = DOC_TYPES[type];
  return usersWithPermission(m, approvePermission, creatorId, warehouseScoped ? warehouseId : undefined);
}

/** Active users holding `permission` (and the warehouse when given), excluding `excludeUserId`. */
export function usersWithPermission(m: EntityManager, permission: string, excludeUserId: number, warehouseId?: number) {
  return m.query(
    `SELECT DISTINCT u.id, u.username, u.full_name AS "fullName"
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = $1
      WHERE u.is_active AND u.id <> $2
        AND ($3::int IS NULL OR EXISTS (SELECT 1 FROM user_warehouses uw WHERE uw.user_id = u.id AND uw.warehouse_id = $3))
      ORDER BY u.username`,
    [permission, excludeUserId, warehouseId ?? null],
  ) as Promise<{ id: number; username: string; fullName: string }[]>;
}

/** DRAFT/REJECTED → WAITING_FOR_APPROVE with an assigned approver (P3: data-level authorization). */
export async function submit(m: EntityManager, type: DocType, doc: DocHeader, user: CurrentUser, approverId: number) {
  assertCreator(doc, user);
  assertStatus(doc, ['DRAFT', 'REJECTED']);
  const eligible = await eligibleApprovers(m, type, doc.created_by, doc.warehouse_id);
  if (!eligible.some((u) => u.id === approverId)) {
    throw new BusinessError('APPROVER_NOT_ELIGIBLE', 'Selected approver lacks the approve permission or warehouse access');
  }
  await setStatus(m, type, doc, 'WAITING_FOR_APPROVE', ', assigned_approver_id = $3', [approverId]);
  await record(m, type, doc.id, 'SUBMIT', user.id);
}

/** Only the assigned approver may decide; the creator never approves (03 §6). */
export function assertAssignedApprover(doc: DocHeader, user: CurrentUser) {
  assertStatus(doc, ['WAITING_FOR_APPROVE']);
  if (doc.assigned_approver_id !== user.id || doc.created_by === user.id) {
    throw new BusinessError('NOT_ASSIGNED_APPROVER', 'You are not the assigned approver of this document', HttpStatus.FORBIDDEN);
  }
}

/** Caller runs type-specific checks and side effects inside the same transaction before this commits. */
export async function approve(m: EntityManager, type: DocType, doc: DocHeader, user: CurrentUser) {
  assertAssignedApprover(doc, user);
  await setStatus(m, type, doc, 'APPROVED');
  await record(m, type, doc.id, 'APPROVE', user.id);
}

export async function reject(m: EntityManager, type: DocType, doc: DocHeader, user: CurrentUser, reason: string) {
  assertAssignedApprover(doc, user);
  await setStatus(m, type, doc, 'REJECTED');
  await record(m, type, doc.id, 'REJECT', user.id, reason);
}

/** WAITING_FOR_APPROVE → DRAFT by the creator (recall of APPROVED documents is type-specific and not here). */
export async function recallPending(m: EntityManager, type: DocType, doc: DocHeader, user: CurrentUser, reason: string, allowed = ["WAITING_FOR_APPROVE"]) {
  assertCreator(doc, user);
  assertStatus(doc, allowed);
  await setStatus(m, type, doc, 'DRAFT');
  await record(m, type, doc.id, 'RECALL', user.id, reason);
}

export async function cancel(m: EntityManager, type: DocType, doc: DocHeader, user: CurrentUser, allowed = ['DRAFT', 'REJECTED'], reason?: string) {
  assertCreator(doc, user);
  assertStatus(doc, allowed);
  await setStatus(m, type, doc, 'CANCELED');
  await record(m, type, doc.id, 'CANCEL', user.id, reason);
}

/**
 * Reject / recall / cancel for one-level documents. Recall or cancel of an APPROVED document is allowed only
 * when `hasActiveChildren` is false (03 §6); a reason is required then too (04 §6: the previous approver is told why).
 */
export async function decide(m: EntityManager, type: DocType, doc: DocHeader, user: CurrentUser, action: 'reject' | 'recall' | 'cancel',
  reason: string | undefined, hasActiveChildren: () => Promise<boolean>) {
  if ((action !== 'cancel' || doc.approval_status === 'APPROVED') && !reason?.trim()) throw new BusinessError('REASON_REQUIRED', 'A reason is required');
  if (action === 'reject') return reject(m, type, doc, user, reason!);
  if (doc.approval_status === 'APPROVED' && (await hasActiveChildren())) {
    throw new BusinessError('HAS_ACTIVE_CHILD_DOCUMENTS', `${doc.document_number} is referenced by documents that are not canceled`, HttpStatus.CONFLICT);
  }
  if (action === 'recall') return recallPending(m, type, doc, user, reason!, ['WAITING_FOR_APPROVE', 'APPROVED']);
  return cancel(m, type, doc, user, ['DRAFT', 'REJECTED', 'APPROVED'], reason);
}

/** Header fields shared by every document list/detail query (alias `d`). */
export const DOC_COLUMNS = `d.id, d.document_number AS "documentNumber", d.approval_status AS "approvalStatus", d.version,
  d.created_by AS "createdBy", d.assigned_approver_id AS "assignedApproverId", d.created_at AS "createdAt",
  (SELECT full_name FROM users WHERE id = d.created_by) AS "createdByName",
  (SELECT full_name FROM users WHERE id = d.assigned_approver_id) AS "assignedApproverName"`;

export function history(m: EntityManager, type: DocType, id: number) {
  return m.query(
    `SELECT h.action, h.reason, h.created_at AS "createdAt", u.full_name AS "actorName"
       FROM approval_histories h JOIN users u ON u.id = h.actor_id
      WHERE h.document_type = $1 AND h.document_id = $2 ORDER BY h.id`,
    [type, id],
  );
}
