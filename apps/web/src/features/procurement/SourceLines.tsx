import { useTranslation } from 'react-i18next';
import { Stack, TextField, Typography } from '@mui/material';
import { num } from '../../shared/utils/format';
import { DocDetail } from './types';

export interface SourceLine { id: number; partNumber: string; productName: string; uom: string; quantity: string; remaining: string; prNumber: string; salesContractNumber?: string }

/** Quantity input bounded by what the source line still allows. */
function QtyField({ value, max, onChange, label }: { value: string; max: number; onChange: (v: string) => void; label: string }) {
  const { t } = useTranslation();
  const over = num(value) > max;
  return (
    <TextField label={label} type="number" value={value} onChange={(e) => onChange(e.target.value)} sx={{ maxWidth: { sm: 160 } }}
      error={over} helperText={over ? t('doc.overRemaining', { max }) : undefined} slotProps={{ htmlInput: { min: 0, max } }} />
  );
}

/** Lines of a source document with a quantity per line, prefilled with the remaining quantity. */
export function SourceLinesPicker({ lines, qty, setQty }: { lines: SourceLine[]; qty: Record<number, string>; setQty: (q: Record<number, string>) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {lines.map((l) => (
        <Stack key={l.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider', alignItems: { sm: 'center' } }}>
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.partNumber}: {l.productName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[l.prNumber, l.salesContractNumber].filter(Boolean).join(', ')}. {t('doc.remaining', { remaining: num(l.remaining), uom: l.uom })}
            </Typography>
          </Stack>
          <QtyField label={t('gr.quantity')} value={qty[l.id] ?? ''} max={num(l.remaining)} onChange={(v) => setQty({ ...qty, [l.id]: v })} />
        </Stack>
      ))}
    </>
  );
}

export const pickedLines = (lines: SourceLine[] | undefined, qty: Record<number, string>) =>
  (lines ?? []).filter((l) => num(qty[l.id] ?? 0) > 0).map((l) => ({ sourceLineId: l.id, quantity: num(qty[l.id]) }));
export const withinRemaining = (lines: SourceLine[] | undefined, qty: Record<number, string>) => (lines ?? []).every((l) => num(qty[l.id] ?? 0) <= num(l.remaining));

/** Adds existing line ids when editing; edit lines whose source is no longer listed (nothing left) are kept unchanged. */
export function withEditLines(picked: { sourceLineId: number; quantity: number }[], edit: DocDetail | undefined, listed: SourceLine[] | undefined) {
  if (!edit) return picked;
  const ids = new Map(edit.lines.map((l) => [l.sourceLineId, l.id]));
  const shown = new Set((listed ?? []).map((l) => l.id));
  return [
    ...picked.map((p) => ({ ...p, id: ids.get(p.sourceLineId) })),
    ...edit.lines.filter((l) => !shown.has(l.sourceLineId)).map((l) => ({ id: l.id, sourceLineId: l.sourceLineId, quantity: num(l.quantity) })),
  ];
}
export const editQty = (edit?: DocDetail) => Object.fromEntries((edit?.lines ?? []).map((l) => [l.sourceLineId, String(num(l.quantity))]));

export function EditHint({ edit, hint }: { edit?: DocDetail; hint: string }) {
  const { t } = useTranslation();
  return <Typography variant="body2" color="text.secondary">{edit?.approvalStatus === 'REJECTED' ? t('doc.editRejectedHint') : hint}</Typography>;
}
