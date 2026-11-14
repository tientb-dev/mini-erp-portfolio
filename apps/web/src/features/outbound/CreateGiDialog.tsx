import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Autocomplete, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { num } from '../../shared/utils/format';
import { GirDetail } from './types';

export function CreateGiDialog({ gir, onClose, onCreated }: { gir: GirDetail; onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [serials, setSerials] = useState<Record<number, { goodsReceiptDetailId: number; serialNumber: string }[]>>({});
  const lines = gir.lines.map((l) => ({ ...l, remaining: num(l.quantity) - num(l.committedQuantity) }));
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/goods-issues', {
      method: 'POST',
      body: JSON.stringify({
        goodsIssueRequestId: gir.id,
        lines: lines.filter((l) => num(qty[l.id] ?? 0) > 0).map((l) => ({
          goodsIssueRequestLineId: l.id, quantity: num(qty[l.id]), goodsReceiptDetailIds: (serials[l.id] ?? []).map((s) => s.goodsReceiptDetailId),
        })),
      }),
    }),
    onSuccess: (r) => onCreated(r.id),
  });
  return (
    <FormDialog title={t('gi.create')} submitLabel={t('gi.create')} error={create.error} pending={create.isPending}
      canSubmit={lines.some((l) => num(qty[l.id] ?? 0) > 0)} onSubmit={() => create.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{t('gi.createHint')}</Typography>
      {lines.map((l) => (
        <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.partNumber}: {l.productName}</Typography>
          <Typography variant="body2" color="text.secondary">{t('gi.remaining', { remaining: l.remaining, uom: l.uom })}</Typography>
          <TextField label={t('gi.issueQuantity')} type="number" value={qty[l.id] ?? ''} sx={{ maxWidth: 200 }} disabled={l.remaining <= 0}
            slotProps={{ htmlInput: { min: 0, max: l.remaining, step: 1 } }} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
          {l.isSerialTracked && num(qty[l.id] ?? 0) > 0 && (
            <SerialPicker girLineId={l.id} max={num(qty[l.id])} value={serials[l.id] ?? []} onChange={(v) => setSerials({ ...serials, [l.id]: v })} />
          )}
        </Stack>
      ))}
    </FormDialog>
  );
}

function SerialPicker({ girLineId, max, value, onChange }: {
  girLineId: number; max: number; value: { goodsReceiptDetailId: number; serialNumber: string }[]; onChange: (v: typeof value) => void;
}) {
  const { t } = useTranslation();
  const options = useQuery({
    queryKey: ['serials', girLineId],
    queryFn: () => api<{ goodsReceiptDetailId: number; serialNumber: string }[]>(`/goods-issue-request-lines/${girLineId}/available-serials`),
  });
  return (
    <Autocomplete multiple size="small" options={options.data ?? []} value={value} loading={options.isLoading}
      getOptionLabel={(o) => o.serialNumber} isOptionEqualToValue={(a, b) => a.goodsReceiptDetailId === b.goodsReceiptDetailId}
      getOptionDisabled={(o) => value.length >= max && !value.some((v) => v.goodsReceiptDetailId === o.goodsReceiptDetailId)}
      onChange={(_e, v) => onChange(v)}
      renderInput={(params) => <TextField {...params} label={t('gi.serials', { selected: value.length, max })} />} />
  );
}
