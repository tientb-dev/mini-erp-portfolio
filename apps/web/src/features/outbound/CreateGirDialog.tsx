import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { num } from '../../shared/utils/format';
import { useMe } from '../identity';
import { PrLineOption, ScLine, StockSource } from './types';

export function CreateGirDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const [issueType, setIssueType] = useState('PURCHASE_REQUISITION');
  const [category, setCategory] = useState('SALES_GOODS');
  const [prQty, setPrQty] = useState<Record<number, string>>({});
  const [source, setSource] = useState(''); // "<source HĐ id>:<source Sales id>"
  const [purpose, setPurpose] = useState('');
  const [dQty, setDQty] = useState<Record<number, string>>({});
  const [scId, setScId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Record<number, { productId: string; quantity: string }>>({});
  const contracts = useQuery({ queryKey: ['scs'], queryFn: () => api<{ id: number; documentNumber: string; status: string; customerName: string }[]>('/sales-contracts') });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ id: number; code: string; name: string; allowAvailableStockIssue: boolean }[]>('/warehouses') });
  const scLines = useQuery({ queryKey: ['sc-lines', scId], queryFn: () => api<ScLine[]>(`/sales-contracts/${scId}/lines`), enabled: Boolean(scId) });
  const isPr = issueType === 'PURCHASE_REQUISITION';
  const isD = !isPr && category === 'MATERIAL';
  const sources = useQuery({
    queryKey: ['stock-sources', warehouseId, scId],
    queryFn: () => api<StockSource[]>(`/warehouses/${warehouseId}/available-stock-sources?targetSalesContractId=${scId}`),
    enabled: Boolean(!isPr && warehouseId && scId),
  });
  const sourceKeys = [...new Map((sources.data ?? []).map((s) => [`${s.sourceSalesContractId}:${s.sourceOwnerUserId}`, s])).entries()];
  const inSource = (sources.data ?? []).filter((s) => `${s.sourceSalesContractId}:${s.sourceOwnerUserId}` === source);
  const availableOf = (productId: number) => inSource.find((s) => s.productId === productId)?.available ?? 0;
  const dChosen = inSource.filter((s) => num(dQty[s.productId] ?? '') > 0);
  const [srcId, srcOwner] = source.split(':').map(Number);
  const prLines = useQuery({ queryKey: ['gir-pr-lines', scId], queryFn: () => api<PrLineOption[]>(`/sales-contracts/${scId}/gir-pr-lines`), enabled: Boolean(scId && isPr) });
  const prChosen = (prLines.data ?? []).filter((l) => l.category === category && num(prQty[l.id] ?? '') > 0);
  const quota = useQuery({ queryKey: ['quota', scId], queryFn: () => api<{ salesContractLineId: number; contractQuantity: string; usedQuantity: string }[]>(`/sales-contracts/${scId}/gir-quota`), enabled: Boolean(scId) });
  const qc = useQueryClient();
  const chosen = Object.entries(lines).filter(([, l]) => l.productId && num(l.quantity) > 0);
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/goods-issue-requests', {
      method: 'POST',
      body: JSON.stringify({
        issueType, salesContractId: Number(scId), warehouseId: Number(warehouseId), purpose: purpose.trim() || undefined,
        ...(isPr ? {} : { category, sourceSalesContractId: srcId, sourceOwnerUserId: srcOwner }),
        lines: isPr
          ? prChosen.map((l) => ({ purchaseRequisitionLineId: l.id, quantity: num(prQty[l.id]) }))
          : isD
            ? dChosen.map((s) => ({ productId: s.productId, quantity: num(dQty[s.productId]) }))
            : chosen.map(([lineId, l]) => ({ salesContractLineId: Number(lineId), productId: Number(l.productId), quantity: num(l.quantity) })),
      }),
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['girs'] }); onCreated(r.id); },
  });
  const allowedWarehouses = (warehouses.data ?? []).filter((w) => me.data?.warehouseIds.includes(w.id) && (issueType !== 'AVAILABLE_STOCK' || w.allowAvailableStockIssue));
  return (
    <FormDialog title={t('gir.create')} submitLabel={t('gir.create')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(scId && warehouseId && (isPr ? prChosen.length : source && (isD ? dChosen.length && purpose.trim() : chosen.length)))}
      onSubmit={() => create.mutate()} onClose={onClose}>
      <TextField select label={t('gir.type')} value={issueType} onChange={(e) => { setIssueType(e.target.value); setWarehouseId(''); }}>
        {['PURCHASE_REQUISITION', 'AVAILABLE_STOCK'].map((v) => <MenuItem key={v} value={v}>{t(`gir.types.${v}`)}</MenuItem>)}
      </TextField>
      {(
        <TextField select label={t('pr.category')} value={category} onChange={(e) => { setCategory(e.target.value); setPrQty({}); setDQty({}); setLines({}); }} helperText={t('gir.categoryHint')}>
          {['SALES_GOODS', 'MATERIAL'].map((c) => <MenuItem key={c} value={c}>{t(`category.${c}`)}</MenuItem>)}
        </TextField>
      )}
      <TextField select label={t('gir.salesContract')} value={scId} onChange={(e) => { setScId(e.target.value); setLines({}); }} required>
        {(contracts.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => <MenuItem key={c.id} value={c.id}>{c.documentNumber}: {c.customerName}</MenuItem>)}
      </TextField>
      <TextField select label={t('inventory.warehouse')} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
        helperText={issueType === 'AVAILABLE_STOCK' ? t('gir.availableStockWarehouseHint') : undefined}>
        {allowedWarehouses.map((w) => <MenuItem key={w.id} value={w.id}>{w.code}: {w.name}</MenuItem>)}
      </TextField>
      {!isPr && warehouseId && scId && (
        <TextField select label={t('gir.source')} value={source} onChange={(e) => { setSource(e.target.value); setDQty({}); }} required
          helperText={sources.data && !sourceKeys.length ? t('gir.noSource') : t('gir.sourceHint')}>
          {sourceKeys.map(([key, s]) => <MenuItem key={key} value={key}>{s.sourceSalesContractNumber} · {s.sourceOwnerName}</MenuItem>)}
        </TextField>
      )}
      {(category === 'MATERIAL') && (
        <TextField label={t('gir.purpose')} value={purpose} onChange={(e) => setPurpose(e.target.value)} required={isD}
          helperText={t(isD ? 'gir.purposeRequired' : 'gir.purposeInherited')} />
      )}
      {isD && inSource.map((s) => (
        <Stack key={s.productId} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider', alignItems: { sm: 'center' } }}>
          <Typography variant="body2" sx={{ flex: 1 }}>{s.partNumber}: {s.productName} — {t('gir.sourceAvailable', { available: s.available })}</Typography>
          <TextField label={t('gr.quantity')} type="number" value={dQty[s.productId] ?? ''} sx={{ maxWidth: { sm: 160 } }}
            onChange={(e) => setDQty({ ...dQty, [s.productId]: e.target.value })} />
        </Stack>
      ))}
      {isPr && scId && prLines.data && !prLines.data.some((l) => l.category === category) && (
        <Typography variant="body2" color="text.secondary">{t('gir.noPoDonePr')}</Typography>
      )}
      {isPr && (prLines.data ?? []).filter((l) => l.category === category).map((l) => (
        <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.prNumber} · {l.partNumber}: {l.productName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('gir.prLineHint', { quantity: num(l.quantity), remaining: l.remainingQuantity, received: num(l.receivedQuantity), uom: l.uom })}
          </Typography>
          {/* Over the remaining quota: warn only; a DRAFT may still be saved (CT2), the server blocks at submit. */}
          <TextField label={t('gr.quantity')} type="number" value={prQty[l.id] ?? ''} sx={{ maxWidth: { sm: 260 } }}
            error={num(prQty[l.id] ?? '') > l.remainingQuantity}
            helperText={num(prQty[l.id] ?? '') > l.remainingQuantity ? t('gir.overRemaining', { max: l.remainingQuantity }) : undefined}
            slotProps={{ htmlInput: { min: 0 } }} onChange={(e) => setPrQty({ ...prQty, [l.id]: e.target.value })} />
        </Stack>
      ))}
      {!isPr && !isD && source && (scLines.data ?? []).map((l) => {
        const q = quota.data?.find((x) => x.salesContractLineId === l.id);
        const remaining = q ? num(q.contractQuantity) - num(q.usedQuantity) : num(l.quantity);
        const v = lines[l.id] ?? { productId: '', quantity: '' };
        return (
          <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.itemName}</Typography>
            <Typography variant="body2" color="text.secondary">{t('gir.quotaHint', { contract: num(l.quantity), remaining })}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField select fullWidth label={t('gir.product')} value={v.productId}
                helperText={!l.products.some((p) => p.status === 'APPROVED') ? t('gir.noConfirmedProduct')
                  : v.productId ? t('gir.sourceAvailable', { available: availableOf(Number(v.productId)) }) : undefined} onChange={(e) => setLines({ ...lines, [l.id]: { ...v, productId: e.target.value } })}>
                {/* Only products Sales confirmed for this line (03 §9.2) */}
                {l.products.filter((p) => p.status === 'APPROVED').map((p) => <MenuItem key={p.productId} value={p.productId}>{p.partNumber}: {p.name}</MenuItem>)}
              </TextField>
              <TextField label={t('gr.quantity')} type="number" value={v.quantity} sx={{ maxWidth: { sm: 160 } }}
                slotProps={{ htmlInput: { min: 0, max: remaining } }}
                onChange={(e) => setLines({ ...lines, [l.id]: { ...v, quantity: e.target.value } })} />
            </Stack>
          </Stack>
        );
      })}
    </FormDialog>
  );
}
