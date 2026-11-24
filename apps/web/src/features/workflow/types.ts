export interface Person { id: number; fullName: string; username: string }
export interface HistoryEntry {
  action: string; reason: string | null; createdAt: string; actorName: string;
  round?: number | null; previousStatus?: string | null; nextStatus?: string | null;
  metadata?: { step?: string; from?: { fullName: string }; to?: { fullName: string } } | null;
}
export type DocAction = 'submit' | 'approve' | 'receive' | 'reject' | 'recall' | 'cancel' | 'complete' | 'reassign';
export interface WorkflowActionContext { version: number; round: number; step: 'CREATE' | 'APPROVAL' | 'RECEIPT' | 'CLOSED' }
