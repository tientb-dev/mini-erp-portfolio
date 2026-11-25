import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, MenuItem, TextField, Typography } from '@mui/material';
import { api, ApiError } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { DocAction, Person, WorkflowActionContext } from './types';
import Check from '@mui/icons-material/Check';
import type { ActionResult } from '../../shared/components/ActionResultDialog';

/**
 * Confirmation dialog for workflow actions on `${basePath}/${action}`. Submit picks the assigned approver
 * (preselected when exactly one is eligible, P4); reject/recall need a reason; complete takes an optional reason.
 */
export function DocActionDialog({ basePath, action, onClose, onDone, approversPath, approved, sourceConfirm, context, draftCandidates, currentAssignee, document, onResult }: {
  basePath: string; action: DocAction; onClose: () => void; onDone: () => void; approversPath?: string;
  /** Cancel of an APPROVED document needs a reason (03 §6, 04 §6). */ approved?: boolean;
  /** Step 1 of an available-stock GIR: the source Sales confirms (same API call as approve, labelled "Xác nhận"). */ sourceConfirm?: boolean;
  context?: WorkflowActionContext;
  draftCandidates?: { approverId?: number | null; receiverId?: number | null };
  currentAssignee?: string | null;
  document?: { type: string; number: string };
  onResult?: (result: ActionResult) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState(String(draftCandidates?.approverId ?? ''));
  const [receiverId, setReceiverId] = useState(String(draftCandidates?.receiverId ?? ''));
  const [replacementId, setReplacementId] = useState('');
  const reassign = action === 'reassign';
  const replacements = useQuery({
    queryKey: ['pr-reassignment-candidates', basePath, context?.version],
    queryFn: () => api<{ candidates: Person[] }>(`${basePath}/reassignment-candidates`),
    enabled: reassign,
  });
  const selectPrCandidates = action === 'submit' && Boolean(context);
  const candidates = useQuery({
    queryKey: ['pr-candidates', basePath],
    queryFn: () => api<{ approvers: Person[]; receivers: Person[] }>(`${basePath}/candidates`),
    enabled: selectPrCandidates,
  });
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
  const needsReason = reassign || action === 'reject' || action === 'recall' || (action === 'cancel' && Boolean(approved));
  const run = useMutation({
    mutationFn: () => api(`${basePath}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        ...context,
        approverId: selectPrCandidates ? Number(approverId) : selectApprover ? Number(chosen) : undefined,
        receiverId: selectPrCandidates ? Number(receiverId) : undefined,
        assigneeId: reassign ? Number(replacementId) : undefined,
        reason: needsReason || action === 'complete' ? reason || undefined : undefined,
      }),
    }),
    onSuccess: () => { onDone(); onResult?.({ success: true }); },
    onError: error => {
      if (onResult && (!(error instanceof ApiError) || ![400, 422].includes(error.status))) onResult({ success: false, error });
    },
  });
  const stale = run.error instanceof ApiError && run.error.code === 'STALE_WORKFLOW_CONTEXT';
  const receive = action === 'receive';
  const validCandidates = candidates.data?.approvers.some(person => person.id === Number(approverId))
    && candidates.data?.receivers.some(person => person.id === Number(receiverId));
  const validReplacement = replacements.data?.candidates.some(person => person.id === Number(replacementId));
  const label = sourceConfirm ? t('gir.confirm') : receive ? t('pr.receive') : t(`doc.${action}`);
  const effect = action === 'approve' ? 'pr.approveHint' : receive ? 'pr.receiveHint' : `pr.confirmEffect.${action}`;
  return (
    <FormDialog title={document ? t('doc.confirmAction', { action: label }) : sourceConfirm ? t('gir.confirmTitle') : receive ? t('pr.receive') : t(`doc.confirm.${action}`)}
      description={document && <>{document.type} {document.number}</>}
      submitLabel={label} submitIcon={document ? <Check /> : undefined}
      submitColor={document && (action === 'reject' || action === 'cancel') ? 'error' : undefined}
      error={run.error ?? approvers.error ?? candidates.error ?? replacements.error} pending={run.isPending}
      canSubmit={!stale && (!needsReason || Boolean(reason.trim())) && (!reassign || Boolean(validReplacement))
        && (!selectPrCandidates || Boolean(validCandidates)) && (!selectApprover || Boolean(chosen))} onSubmit={() => run.mutate()} onClose={onClose}>
      {stale && <Button onClick={onDone}>{t('pr.reload')}</Button>}
      {document && <Typography variant="body2">{t(effect)}</Typography>}
      {reassign && <>
        <TextField label={t('pr.currentAssignee')} value={currentAssignee ?? ''} slotProps={{ input: { readOnly: true } }} />
        <TextField select label={t('pr.replacement')} value={validReplacement ? replacementId : ''}
          onChange={e => setReplacementId(e.target.value)} required
          helperText={replacements.data?.candidates.length === 0 ? t('pr.emptyPool') : undefined}>
          <MenuItem value="" disabled>{t('pr.noSelection')}</MenuItem>
          {replacements.data?.candidates.map(person => <MenuItem key={person.id} value={person.id}>{person.fullName} ({person.username})</MenuItem>)}
        </TextField>
      </>}
      {selectPrCandidates && <>
        <TextField select label={t('gr.approver')} value={candidates.data?.approvers.some(person => person.id === Number(approverId)) ? approverId : ''} onChange={e => setApproverId(e.target.value)} required
          helperText={candidates.data?.approvers.length === 0 ? t('pr.emptyPool') : undefined}>
          <MenuItem value="" disabled>{t('pr.noSelection')}</MenuItem>
          {candidates.data?.approvers.map(person => <MenuItem key={person.id} value={person.id}>{person.fullName} ({person.username})</MenuItem>)}
        </TextField>
        <TextField select label={t('pr.receiver')} value={candidates.data?.receivers.some(person => person.id === Number(receiverId)) ? receiverId : ''} onChange={e => setReceiverId(e.target.value)} required
          helperText={candidates.data?.receivers.length === 0 ? t('pr.emptyPool') : undefined}>
          <MenuItem value="" disabled>{t('pr.noSelection')}</MenuItem>
          {candidates.data?.receivers.map(person => <MenuItem key={person.id} value={person.id}>{person.fullName} ({person.username})</MenuItem>)}
        </TextField>
      </>}
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
      {!document && (action === 'approve' || receive) && <Typography variant="body2">{t(sourceConfirm ? 'gir.confirmHint' : receive ? 'pr.receiveHint' : 'doc.approveHint')}</Typography>}
      {!document && action === 'cancel' && !approved && <Typography variant="body2">{t('doc.cancelHint')}</Typography>}
    </FormDialog>
  );
}
