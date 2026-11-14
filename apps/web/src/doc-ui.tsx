import { createContext, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from './api';
import { FormDialog } from './pages';
import { StatusChip } from './ui';

/** Shared pieces for document screens (GIR, GI). */

export interface Me { id: number; permissions: string[]; warehouseIds: number[] }
export interface Person { id: number; fullName: string; username: string }
export interface HistoryEntry { action: string; reason: string | null; createdAt: string; actorName: string }

/** Opens another page on one document (`page` is an App page key); the target page checks permissions again. */
export const NavContext = createContext<(page: string, id: number) => void>(() => undefined);

export const fmtDate = (v: string) => new Date(v).toLocaleString();
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: { sm: 200 }, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" component="div">{children}</Typography>
    </Stack>
  );
}

export function HistoryList({ history }: { history: HistoryEntry[] }) {
  const { t } = useTranslation();
  if (!history.length) return <Typography variant="body2" color="text.secondary">{t('gr.noHistory')}</Typography>;
  return (
    <>
      {history.map((h, i) => (
        <Field key={i} label={fmtDate(h.createdAt)}>
          {t(`doc.history.${h.action}`)}: {h.actorName}{h.reason ? `. ${h.reason}` : ''}
        </Field>
      ))}
    </>
  );
}

export function ExecutionChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = status === 'COMPLETED' ? 'success' : status === 'IN_PROGRESS' ? 'pending' : 'neutral';
  return <StatusChip label={t(`execution.${status}`)} tone={tone} />;
}

export type DocAction = 'submit' | 'approve' | 'reject' | 'recall' | 'cancel' | 'complete';

/**
 * Confirmation dialog for workflow actions on `${basePath}/${action}`. Submit picks the assigned approver
 * (preselected when exactly one is eligible, P4); reject/recall need a reason; complete takes an optional reason.
 */
export function DocActionDialog({ basePath, action, onClose, onDone, approversPath, approved, sourceConfirm }: {
  basePath: string; action: DocAction; onClose: () => void; onDone: () => void; approversPath?: string;
  /** Cancel of an APPROVED document needs a reason (03 §6, 04 §6). */ approved?: boolean;
  /** Step 1 of an available-stock GIR: the source Sales confirms (same API call as approve, labelled "Xác nhận"). */ sourceConfirm?: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const approvers = useQuery({
    queryKey: ['approvers', approversPath],
    // GIR returns { approvers, warehouseApprovers }; one-step documents return the list directly.
    queryFn: async () => {
      const data = await api<Person[] | { approvers: Person[] }>(approversPath!);
      return Array.isArray(data) ? data : data.approvers;
    },
    enabled: action === 'submit',
  });
  const chosen = approverId || (approvers.data?.length === 1 ? String(approvers.data[0].id) : '');
  const needsReason = action === 'reject' || action === 'recall' || (action === 'cancel' && Boolean(approved));
  const run = useMutation({
    mutationFn: () => api(`${basePath}/${action}`, {
      method: 'POST',
      body: JSON.stringify(action === 'submit' ? { approverId: Number(chosen) } : needsReason || action === 'complete' ? { reason: reason || undefined } : {}),
    }),
    onSuccess: onDone,
  });
  return (
    <FormDialog title={sourceConfirm ? t('gir.confirmTitle') : t(`doc.confirm.${action}`)} submitLabel={sourceConfirm ? t('gir.confirm') : t(`doc.${action}`)} error={run.error ?? approvers.error} pending={run.isPending}
      canSubmit={action === 'submit' ? Boolean(chosen) : needsReason ? Boolean(reason.trim()) : true} onSubmit={() => run.mutate()} onClose={onClose}>
      {action === 'submit' && (
        <TextField select label={t('gr.approver')} value={chosen} onChange={(e) => setApproverId(e.target.value)} required
          helperText={approvers.data?.length === 0 ? t('gr.noApprover') : undefined}>
          {(approvers.data ?? []).map((u) => <MenuItem key={u.id} value={u.id}>{u.fullName} ({u.username})</MenuItem>)}
        </TextField>
      )}
      {(needsReason || action === 'complete') && (
        <TextField label={t('gr.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason} multiline minRows={2} autoFocus
          helperText={action === 'complete' ? t('doc.completeHint') : undefined} />
      )}
      {action === 'approve' && <Typography variant="body2">{t(sourceConfirm ? 'gir.confirmHint' : 'doc.approveHint')}</Typography>}
      {action === 'cancel' && !approved && <Typography variant="body2">{t('doc.cancelHint')}</Typography>}
    </FormDialog>
  );
}
