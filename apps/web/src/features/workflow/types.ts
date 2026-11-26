export interface Person { id: number; fullName: string; username: string }
type DossierActivityValue = {
  hasPaper: boolean; issuedOn: string | null; issuer: string | null; note: string | null; file: { id: number; name: string } | null;
};
export interface HistoryEntry {
  action: string; reason: string | null; createdAt: string; actorName: string;
  round?: number | null; previousStatus?: string | null; nextStatus?: string | null;
  metadata?: { step?: string; from?: { fullName: string }; to?: { fullName: string }; code?: string; name?: string;
    before?: DossierActivityValue; after?: DossierActivityValue; fileAction?: 'UPLOAD' | 'REPLACE' | 'REMOVE' | null } | null;
}
export type DocAction = 'submit' | 'approve' | 'receive' | 'reject' | 'recall' | 'cancel' | 'complete' | 'reassign';
export interface WorkflowActionContext { version: number; round: number; step: 'CREATE' | 'APPROVAL' | 'RECEIPT' | 'CLOSED' }
