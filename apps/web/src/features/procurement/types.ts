import { ComponentType, ReactNode } from 'react';
import { GridColDef } from '@mui/x-data-grid';
import { TFunction } from 'i18next';
import type { HistoryEntry } from '../workflow';

export interface DocRow {
  id: number; documentNumber: string; approvalStatus: string; version: number; createdBy: number; createdByName: string;
  assignedApproverId: number | null; assignedApproverName: string | null; createdAt: string; [extra: string]: unknown;
}
export interface DocLine { id: number; sourceLineId: number | null; productId?: number; ref: string | null; partNumber: string; productName: string; uom: string; quantity: string; usedQuantity?: string; receivedQuantity?: string }
export interface PrNote { id: number; authorName: string; body: string; createdAt: string }
export interface PrNode {
  step: 'APPROVAL' | 'RECEIPT'; round: number; department: string; result: 'APPROVED' | 'REJECTED' | null;
  assigneeName: string; actorName: string | null; actedAt: string | null; invalidatedAt: string | null;
}
export interface DocDetail extends DocRow { lines: DocLine[]; children: { id: number; documentNumber: string; approvalStatus: string }[]; history: HistoryEntry[]; approvalRound?: number; historyCursor?: number | null; nodes?: PrNode[]; notes?: PrNote[]; notesCursor?: number | null; draftApproverId?: number | null; draftReceiverId?: number | null; canReassign?: boolean; canCancel?: boolean; canEdit?: boolean; creatorRole?: string | null; rejection?: HistoryEntry | null }
/** `edit` set = the same form edits that DRAFT/REJECTED document (PATCH); source document fields stay fixed. */
export interface CreateProps { onClose: () => void; onCreated: (id: number) => void; edit?: DocDetail }

export interface DocConfig {
  /** i18n namespace and permission prefix. */
  key: 'pr' | 'po' | 'grr'; perm: 'PR' | 'PO' | 'GRR'; path: string;
  columns: (t: TFunction) => GridColDef<DocRow>[];
  fields: (d: DocDetail, t: TFunction) => [string, ReactNode][];
  Create?: ComponentType<CreateProps>;
}
