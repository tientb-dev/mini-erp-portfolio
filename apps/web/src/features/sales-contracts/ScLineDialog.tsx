import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { Uom } from '../master-data';
import { ScLine } from './types';

/**
 * Adds (no `line`) or edits one HĐ line; each save is its own API call checked against the contract `version`.
 * The UoM is picked from the catalog (no free text).
 */
export function ScLineDialog({ contractId, version, line, onClose, onSaved }: {
  contractId: number; version: number; line?: ScLine; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const initial = {
    itemCode: line?.itemCode ?? '', itemName: line?.itemName ?? '',
    unitOfMeasureId: line ? String(line.unitOfMeasureId) : '', quantity: line ? String(Number(line.quantity)) : '',
  };
  const [f, setF] = useState(initial);
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const uoms = useQuery({ queryKey: ['uoms'], queryFn: () => api<Uom[]>('/units-of-measure') });
  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ itemCode: f.itemCode.trim(), itemName: f.itemName.trim(), unitOfMeasureId: Number(f.unitOfMeasureId), quantity: Number(f.quantity), version });
      return line
        ? api(`/sales-contract-lines/${line.id}`, { method: 'PATCH', body })
        : api(`/sales-contracts/${contractId}/lines`, { method: 'POST', body });
    },
    onSuccess: onSaved,
  });
  const valid = f.itemCode.trim() && f.itemName.trim() && f.unitOfMeasureId && Number(f.quantity) > 0;
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  return (
    <FormDialog title={t(line ? 'sc.editItem' : 'sc.addItem')} submitLabel={t(line ? 'doc.saveEdit' : 'sc.saveItem')} error={save.error} pending={save.isPending}
      canSubmit={Boolean(valid)} onSubmit={() => save.mutate()} onClose={onClose} dirty={dirty}>
      <Typography variant="body2" color="text.secondary">{t('sc.linesHint')}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label={t('sc.itemCode')} value={f.itemCode} onChange={set('itemCode')} required autoFocus sx={{ flex: 1 }} />
        <TextField label={t('sc.itemName')} value={f.itemName} onChange={set('itemName')} required sx={{ flex: 2 }} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField select label={t('sc.uom')} value={f.unitOfMeasureId} onChange={set('unitOfMeasureId')} required sx={{ flex: 1 }}>
          {(uoms.data ?? []).map((u) => <MenuItem key={u.id} value={String(u.id)}>{u.name} ({u.code})</MenuItem>)}
        </TextField>
        <TextField label={t('gr.quantity')} type="number" value={f.quantity} onChange={set('quantity')} required sx={{ flex: 1 }}
          slotProps={{ htmlInput: { min: 0, step: 'any' } }} />
      </Stack>
    </FormDialog>
  );
}
