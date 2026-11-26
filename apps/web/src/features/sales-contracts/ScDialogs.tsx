import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MenuItem, TextField, Typography } from '@mui/material';
import { api, catalogSelectionPath } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { Product } from '../master-data';
import { Proposal, ScLine } from './types';

/** Confirms Chốt/Hủy HĐ; the server re-checks status, responsible sales, lines and PR/GIR references. */
export function ScStatusDialog({ id, kind, onClose, onDone }: { id: number; kind: 'activate' | 'cancel'; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const run = useMutation({ mutationFn: () => api(`/sales-contracts/${id}/${kind}`, { method: 'POST' }), onSuccess: onDone });
  return (
    <FormDialog title={t(`sc.${kind}`)} submitLabel={t(`sc.${kind}`)} submitAction={kind === 'cancel' ? 'void' : 'confirm'} error={run.error} pending={run.isPending} canSubmit onSubmit={() => run.mutate()} onClose={onClose}>
      <Typography variant="body2">{t(`sc.${kind}Hint`)}</Typography>
    </FormDialog>
  );
}

export function DeleteLineDialog({ line, version, onClose, onDone }: { line: ScLine; version: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const run = useMutation({ mutationFn: () => api(`/sales-contract-lines/${line.id}?version=${version}`, { method: 'DELETE' }), onSuccess: onDone });
  return (
    <FormDialog title={t('sc.deleteItem')} submitLabel={t('sc.deleteItem')} submitAction="delete" error={run.error} pending={run.isPending} canSubmit
      onSubmit={() => run.mutate()} onClose={onClose}>
      <Typography variant="body2">{t('sc.deleteItemHint', { code: line.itemCode, name: line.itemName })}</Typography>
    </FormDialog>
  );
}

export function ProposeDialog({ line, onClose, onDone }: { line: ScLine; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState('');
  const [reason, setReason] = useState('');
  const products = useQuery({ queryKey: ['products', 'selection'], queryFn: () => api<Product[]>(catalogSelectionPath('/products')) });
  const taken = new Set(line.products.filter((p) => p.status !== 'REJECTED').map((p) => p.productId));
  const run = useMutation({
    mutationFn: () => api(`/sales-contract-lines/${line.id}/product-proposals`, { method: 'POST', body: JSON.stringify({ productId: Number(productId), reason }) }),
    onSuccess: onDone,
  });
  return (
    <FormDialog title={t('sc.propose')} submitLabel={t('sc.proposeSubmit')} submitAction="submit" error={run.error} pending={run.isPending} dirty={Boolean(productId || reason)}
      canSubmit={Boolean(productId && reason.trim())} onSubmit={() => run.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{line.itemCode}: {line.itemName}</Typography>
      <TextField select label={t('gir.product')} value={productId} onChange={(e) => setProductId(e.target.value)} required>
        {(products.data ?? []).filter((p) => p.isActive && !taken.has(p.id)).map((p) => <MenuItem key={p.id} value={p.id}>{p.partNumber}: {p.name} ({p.unitOfMeasure.code})</MenuItem>)}
      </TextField>
      <TextField label={t('gr.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required multiline minRows={2} helperText={t('sc.proposeHint')} />
    </FormDialog>
  );
}

export function DecideDialog({ proposal, approve, onClose, onDone }: { proposal: Proposal; approve: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const run = useMutation({
    mutationFn: () => api(`/product-proposals/${proposal.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ note: note || undefined }) }),
    onSuccess: onDone,
  });
  return (
    <FormDialog title={t(approve ? 'sc.confirmProduct' : 'sc.rejectProduct')} submitLabel={t(approve ? 'gir.confirm' : 'doc.reject')} submitAction={approve ? 'confirm' : 'reject'} error={run.error}
      pending={run.isPending} canSubmit onSubmit={() => run.mutate()} onClose={onClose} dirty={Boolean(note)}>
      <Typography variant="body2">{proposal.partNumber}: {proposal.name}. {proposal.reason}</Typography>
      <TextField label={t('sc.decisionNote')} value={note} onChange={(e) => setNote(e.target.value)} helperText={t('sc.decisionNoteHint')} autoFocus />
    </FormDialog>
  );
}
