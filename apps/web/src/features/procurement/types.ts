import { ComponentType, ReactNode } from 'react';
import { GridColDef } from '@mui/x-data-grid';
import { TFunction } from 'i18next';
import type { HistoryEntry } from '../workflow';

export interface DocRow {
  id: number; documentNumber: string; approvalStatus: string; version: number; createdBy: number; createdByName: string;
  assignedApproverId: number | null; assignedApproverName: string | null; createdAt: string; [extra: string]: unknown;
}
export interface DocLine { id: number; sourceLineId: number; productId?: number; ref: string; partNumber: string; productName: string; uom: string; quantity: string; usedQuantity?: string; receivedQuantity?: string }
export interface DocDetail extends DocRow { lines: DocLine[]; children: { id: number; documentNumber: string; approvalStatus: string }[]; history: HistoryEntry[] }
/** `edit` set = the same form edits that DRAFT/REJECTED document (PATCH); source document fields stay fixed. */
export interface CreateProps { onClose: () => void; onCreated: (id: number) => void; edit?: DocDetail }

export interface DocConfig {
  /** i18n namespace and permission prefix. */
  key: 'pr' | 'po' | 'grr'; perm: 'PR' | 'PO' | 'GRR'; path: string;
  columns: (t: TFunction) => GridColDef<DocRow>[];
  fields: (d: DocDetail, t: TFunction) => [string, ReactNode][];
  Create: ComponentType<CreateProps>;
}
