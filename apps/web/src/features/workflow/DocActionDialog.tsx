import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MenuItem, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { DocAction, Person } from './types';

/**
 * Confirmation dialog for workflow actions on `${basePath}/${action}`. Submit picks the assigned approver
 * (preselected when exactly one is eligible, P4); reject/recall need a reason; complete takes an optional reason.
 */
export function DocActionDialog({ basePath, action, onClose, onDone, approversPath, approved, sourceConfirm, receive, version }: {
  basePath: string; action: DocAction; onClose: () => void; onDone: () => void; approversPath?: string;
  /** Cancel of an APPROVED document needs a reason (03 §6, 04 §6). */ approved?: boolean;
  /** Step 1 of an available-stock GIR: the source Sales confirms (same API call as approve, labelled "Xác nhận"). */ sourceConfirm?: boolean; receive?: boolean;
  version?: number;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const selectApprover = action === 'submit' && Boolean(approversPath);
  const approvers = useQuery({
    queryKey: ['approvers', approversPath],
    // GIR returns { approvers, warehouseApprovers }; one-step documents return the list directly.
    queryFn: async () => {
      const data = await api<Person[] | { approvers: Person[] }>(approversPath!);
      return Array.isArray(data) ? data : data.approvers;
    },
    enabled: selectApprover,
  });
  const chosen = approverId || (approvers.data?.length === 1 ? String(approvers.data[0].id) : '');
  const needsReason = action === 'reject' || action === 'recall' || (action === 'cancel' && Boolean(approved));
  const run = useMutation({
    mutationFn: () => api(`${basePath}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        version,
        approverId: selectApprover ? Number(chosen) : undefined,
        reason: needsReason || action === 'complete' ? reason || undefined : undefined,
      }),
    }),
    onSuccess: onDone,
  });
  return (
    <FormDialog title={sourceConfirm ? t('gir.confirmTitle') : t(`doc.confirm.${action}`)} submitLabel={sourceConfirm ? t('gir.confirm') : receive ? t('pr.receive') : t(`doc.${action}`)} error={run.error ?? approvers.error} pending={run.isPending}
      canSubmit={selectApprover ? Boolean(chosen) : needsReason ? Boolean(reason.trim()) : true} onSubmit={() => run.mutate()} onClose={onClose}>
      {selectApprover && (
        <TextField select label={t('gr.approver')} value={chosen} onChange={(e) => setApproverId(e.target.value)} required
          helperText={approvers.data?.length === 0 ? t('gr.noApprover') : undefined}>
          {(approvers.data ?? []).map((u) => <MenuItem key={u.id} value={u.id}>{u.fullName} ({u.username})</MenuItem>)}
        </TextField>
      )}
      {(needsReason || action === 'complete') && (
        <TextField label={t('gr.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason} multiline minRows={2} autoFocus
          helperText={action === 'complete' ? t('doc.completeHint') : undefined} />
      )}
      {action === 'approve' && <Typography variant="body2">{t(sourceConfirm ? 'gir.confirmHint' : receive ? 'pr.receiveHint' : 'doc.approveHint')}</Typography>}
      {action === 'cancel' && !approved && <Typography variant="body2">{t('doc.cancelHint')}</Typography>}
    </FormDialog>
  );
}
