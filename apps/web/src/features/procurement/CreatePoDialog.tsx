import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MenuItem, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { CreateProps } from './types';
import { saveDoc } from './api';
import { editQty, EditHint, pickedLines, SourceLine, SourceLinesPicker, withEditLines, withinRemaining } from './SourceLines';

export function CreatePoDialog({ onClose, onCreated, edit }: CreateProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState(edit ? String(edit.supplierId) : '');
  const [qty, setQty] = useState<Record<number, string>>(() => editQty(edit));
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<{ id: number; code: string; name: string }[]>('/suppliers') });
  const lines = useQuery({ queryKey: ['pr-lines-for-po'], queryFn: () => api<SourceLine[]>('/purchase-requisition-lines/available-for-po') });
  const picked = withEditLines(pickedLines(lines.data, qty), edit, lines.data);
  const create = useMutation({
    mutationFn: () => saveDoc('purchase-orders', edit, { supplierId: Number(supplierId), lines: picked }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['po'] }); void qc.invalidateQueries({ queryKey: ['pr-lines-for-po'] }); onCreated(r.id); },
  });
  return (
    <FormDialog title={edit ? t('doc.editTitle', { number: edit.documentNumber }) : t('po.create')} submitLabel={t(edit ? 'doc.saveEdit' : 'po.create')} error={create.error ?? lines.error} pending={create.isPending}
      canSubmit={Boolean(supplierId && picked.length && withinRemaining(lines.data, qty))} onSubmit={() => create.mutate()} onClose={onClose}>
      <EditHint edit={edit} hint={t('po.createHint')} />
      <TextField select label={t('po.supplier')} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required
        helperText={suppliers.data?.length === 0 ? t('po.noSupplier') : undefined}>
        {(suppliers.data ?? []).map((s) => <MenuItem key={s.id} value={s.id}>{s.code}: {s.name}</MenuItem>)}
      </TextField>
      {lines.data?.length === 0 && <Typography variant="body2" color="text.secondary">{t('po.noLines')}</Typography>}
      <SourceLinesPicker lines={lines.data ?? []} qty={qty} setQty={setQty} />
    </FormDialog>
  );
}
