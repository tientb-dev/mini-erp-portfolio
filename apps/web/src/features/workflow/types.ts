export interface Person { id: number; fullName: string; username: string }
export interface HistoryEntry { action: string; reason: string | null; createdAt: string; actorName: string; round?: number | null; previousStatus?: string | null; nextStatus?: string | null }
export type DocAction = 'submit' | 'approve' | 'receive' | 'reject' | 'recall' | 'cancel' | 'complete';
export interface WorkflowActionContext { version: number; round: number; step: 'CREATE' | 'APPROVAL' | 'RECEIPT' | 'CLOSED' }
