import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MenuItem, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { useMe } from '../identity';
import { CreateProps, DocRow } from './types';
import { saveDoc } from './api';
import { editQty, EditHint, pickedLines, SourceLine, SourceLinesPicker, withEditLines, withinRemaining } from './SourceLines';

export function CreateGrrDialog({ onClose, onCreated, edit }: CreateProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [poId, setPoId] = useState(edit ? String(edit.purchaseOrderId) : '');
  const [warehouseId, setWarehouseId] = useState(edit ? String(edit.warehouseId) : '');
  const [qty, setQty] = useState<Record<number, string>>(() => editQty(edit));
  const pos = useQuery({ queryKey: ['po', 'list', false], queryFn: () => api<DocRow[]>('/purchase-orders?assignedToMe=false') });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ id: number; code: string; name: string }[]>('/warehouses') });
  const lines = useQuery({ queryKey: ['po-lines-for-grr', poId], queryFn: () => api<SourceLine[]>(`/purchase-orders/${poId}/lines-available-for-grr`), enabled: Boolean(poId) });
  const picked = withEditLines(pickedLines(lines.data, qty), edit, lines.data);
  const create = useMutation({
    mutationFn: () => saveDoc('goods-receipt-requests', edit, edit ? { lines: picked } : { purchaseOrderId: Number(poId), warehouseId: Number(warehouseId), lines: picked }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['grr'] }); void qc.invalidateQueries({ queryKey: ['po-lines-for-grr'] }); onCreated(r.id); },
  });
  const approvedPos = (pos.data ?? []).filter((p) => p.approvalStatus === 'APPROVED');
  return (
    <FormDialog title={edit ? t('doc.editTitle', { number: edit.documentNumber }) : t('grr.create')} submitLabel={t(edit ? 'doc.saveEdit' : 'grr.create')} error={create.error ?? lines.error} pending={create.isPending}
      canSubmit={Boolean(poId && warehouseId && picked.length && withinRemaining(lines.data, qty))} onSubmit={() => create.mutate()} onClose={onClose}>
      <EditHint edit={edit} hint={t('grr.createHint')} />
      <TextField select disabled={Boolean(edit)} label={t('gr.po')} value={poId} onChange={(e) => { setPoId(e.target.value); setQty({}); }} required
        helperText={pos.data && !approvedPos.length ? t('grr.noPo') : undefined}>
        {approvedPos.map((p) => <MenuItem key={p.id} value={p.id}>{p.documentNumber}: {String(p.supplierName)}</MenuItem>)}
      </TextField>
      <TextField select disabled={Boolean(edit)} label={t('inventory.warehouse')} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
        {(warehouses.data ?? []).filter((w) => me.data?.warehouseIds.includes(w.id)).map((w) => <MenuItem key={w.id} value={w.id}>{w.code}: {w.name}</MenuItem>)}
      </TextField>
      {poId && lines.data?.length === 0 && <Typography variant="body2" color="text.secondary">{t('grr.noLines')}</Typography>}
      <SourceLinesPicker lines={lines.data ?? []} qty={qty} setQty={setQty} />
    </FormDialog>
  );
}
