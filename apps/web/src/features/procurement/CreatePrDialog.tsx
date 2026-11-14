import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { num } from '../../shared/utils/format';
import type { Product } from '../master-data';
import { CreateProps } from './types';
import { saveDoc } from './api';
import { EditHint } from './SourceLines';

export interface ScOption { id: number; documentNumber: string; status: string; customerName: string }
export interface ScLineOption { id: number; itemCode: string; itemName: string; uomName: string; quantity: string }

export function CreatePrDialog({ onClose, onCreated, edit }: CreateProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [scId, setScId] = useState(edit ? String(edit.salesContractId) : '');
  // Sales goods follow the HĐ lines; materials are free lines with an optional HĐ line (CM3: one category per PR).
  const [category, setCategory] = useState<string>(edit ? String(edit.category ?? 'SALES_GOODS') : 'SALES_GOODS');
  const [purpose, setPurpose] = useState('');
  const [materials, setMaterials] = useState<{ id?: number; productId: string; quantity: string }[]>(
    () => (edit?.category === 'MATERIAL' ? edit.lines.map((l) => ({ id: l.id, productId: String(l.productId), quantity: String(num(l.quantity)) })) : [{ productId: '', quantity: '' }]));
  // Keyed by HĐ line: a PR holds at most one line per HĐ line (CM6, enforced by the API).
  const [lines, setLines] = useState<Record<number, { id?: number; productId: string; quantity: string }>>(
    () => Object.fromEntries((edit?.lines ?? []).map((l) => [l.sourceLineId, { id: l.id, productId: String(l.productId), quantity: String(num(l.quantity)) }])));
  const contracts = useQuery({ queryKey: ['scs'], queryFn: () => api<ScOption[]>('/sales-contracts') });
  const scLines = useQuery({ queryKey: ['sc-lines', scId], queryFn: () => api<ScLineOption[]>(`/sales-contracts/${scId}/lines`), enabled: Boolean(scId) });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products') });
  const chosen = Object.entries(lines).filter(([, l]) => l.productId && num(l.quantity) > 0);
  const chosenMaterials = materials.filter((l) => l.productId && num(l.quantity) > 0);
  const isMaterial = category === 'MATERIAL';
  const create = useMutation({
    mutationFn: () => saveDoc('purchase-requisitions', edit, {
      ...(edit ? {} : { salesContractId: Number(scId), category, purpose: isMaterial && purpose.trim() ? purpose.trim() : undefined }),
      lines: isMaterial
        ? chosenMaterials.map((l) => ({ id: l.id, productId: Number(l.productId), quantity: num(l.quantity) }))
        : chosen.map(([lineId, l]) => ({ id: l.id, salesContractLineId: Number(lineId), productId: Number(l.productId), quantity: num(l.quantity) })),
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['pr'] }); onCreated(r.id); },
  });
  return (
    <FormDialog title={edit ? t('doc.editTitle', { number: edit.documentNumber }) : t('pr.create')} submitLabel={t(edit ? 'doc.saveEdit' : 'pr.create')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(scId && (isMaterial ? chosenMaterials.length : chosen.length))} onSubmit={() => create.mutate()} onClose={onClose}>
      <EditHint edit={edit} hint={t('pr.createHint')} />
      <TextField select disabled={Boolean(edit)} label={t('pr.category')} value={category} onChange={(e) => setCategory(e.target.value)}
        helperText={t(isMaterial ? 'pr.materialHint' : 'pr.salesGoodsHint')}>
        {['SALES_GOODS', 'MATERIAL'].map((c) => <MenuItem key={c} value={c}>{t(`category.${c}`)}</MenuItem>)}
      </TextField>
      <TextField select disabled={Boolean(edit)} label={t('gir.salesContract')} value={scId} onChange={(e) => { setScId(e.target.value); setLines({}); }} required
        helperText={contracts.data && !contracts.data.some((c) => c.status === 'ACTIVE') ? t('pr.noActiveContract') : undefined}>
        {(contracts.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => <MenuItem key={c.id} value={c.id}>{c.documentNumber}: {c.customerName}</MenuItem>)}
      </TextField>
      {isMaterial && !edit && <TextField label={t('gir.purpose')} value={purpose} onChange={(e) => setPurpose(e.target.value)} helperText={t('pr.purposeHint')} />}
      {isMaterial && scId && materials.map((v, i) => (
        <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <TextField select fullWidth label={t('pr.material', { n: i + 1 })} value={v.productId}
            onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
            {(products.data ?? []).filter((p) => p.isActive).map((p) => <MenuItem key={p.id} value={p.id}>{p.partNumber}: {p.name} ({p.unitOfMeasure.code})</MenuItem>)}
          </TextField>
          <TextField label={t('gr.quantity')} type="number" value={v.quantity} sx={{ maxWidth: { sm: 160 } }} slotProps={{ htmlInput: { min: 0 } }}
            onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
        </Stack>
      ))}
      {isMaterial && scId && <Button onClick={() => setMaterials([...materials, { productId: '', quantity: '' }])} sx={{ alignSelf: 'flex-start' }}>{t('pr.addMaterial')}</Button>}
      {!isMaterial && (scLines.data ?? []).map((l) => {
        const v = lines[l.id] ?? { productId: '', quantity: '' };
        return (
          <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.itemCode}: {l.itemName} ({num(l.quantity)} {l.uomName})</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField select fullWidth label={t('pr.product')} value={v.productId} onChange={(e) => setLines({ ...lines, [l.id]: { ...v, productId: e.target.value } })}>
                <MenuItem value="">{t('pr.skipLine')}</MenuItem>
                {(products.data ?? []).filter((p) => p.isActive).map((p) => <MenuItem key={p.id} value={p.id}>{p.partNumber}: {p.name} ({p.unitOfMeasure.code})</MenuItem>)}
              </TextField>
              <TextField label={t('gr.quantity')} type="number" value={v.quantity} sx={{ maxWidth: { sm: 160 } }} slotProps={{ htmlInput: { min: 0 } }}
                onChange={(e) => setLines({ ...lines, [l.id]: { ...v, quantity: e.target.value } })} />
            </Stack>
          </Stack>
        );
      })}
    </FormDialog>
  );
}
