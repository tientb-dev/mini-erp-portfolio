export interface Person { id: number; fullName: string; username: string }
export interface HistoryEntry { action: string; reason: string | null; createdAt: string; actorName: string }
export type DocAction = 'submit' | 'approve' | 'reject' | 'recall' | 'cancel' | 'complete';
