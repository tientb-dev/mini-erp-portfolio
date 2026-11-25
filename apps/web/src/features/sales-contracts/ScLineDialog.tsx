import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Box, MenuItem, TextField } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { Product, Uom } from '../master-data';
import { ScLine } from './types';

/**
 * Adds (no `line`) or edits one HĐ line; each save is its own API call checked against the contract `version`.
 * The UoM is picked from the catalog (no free text).
 */
export function ScLineDialog({ contractId, version, line, lines, onClose, onSaved }: {
  contractId: number; version: number; line?: ScLine; lines: ScLine[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const initial = {
    source: line?.productId ? 'main' : line?.temporaryProductId ? 'temporary' : 'free',
    catalogId: String(line?.productId ?? line?.temporaryProductId ?? ''),
    itemDescription: line?.itemDescription ?? '',
    itemCode: line?.itemCode ?? '', itemName: line?.itemName ?? '',
    unitOfMeasureId: line ? String(line.unitOfMeasureId) : '', quantity: line ? String(Number(line.quantity)) : '',
  };
  const [f, setF] = useState(initial);
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const uoms = useQuery({ queryKey: ['uoms'], queryFn: () => api<Uom[]>('/units-of-measure') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products'), enabled: f.source === 'main' });
  const temporary = useQuery({ queryKey: ['temporary-products'], enabled: f.source === 'temporary',
    queryFn: () => api<{ id: number; code: string; name: string; description?: string | null }[]>('/temporary-products') });
  const options = f.source === 'main'
    ? (products.data ?? []).filter(product => product.isActive).map(product => ({
        id: product.id, code: product.partNumber, name: product.name, description: product.description,
        uom: String(product.unitOfMeasure.id),
      }))
    : (temporary.data ?? []).map(item => ({ ...item, uom: undefined }));
  const shownOptions = f.source === initial.source && initial.catalogId && !options.some(item => String(item.id) === initial.catalogId)
    ? [...options, { id: Number(initial.catalogId), code: initial.itemCode, name: initial.itemName,
        description: initial.itemDescription, uom: initial.unitOfMeasureId }]
    : options;
  const duplicate = Boolean(f.itemCode.trim()) && lines.some(other => other.id !== line?.id
    && other.itemCode.trim().toLowerCase() === f.itemCode.trim().toLowerCase());
  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        productId: f.source === 'main' ? Number(f.catalogId) : null,
        temporaryProductId: f.source === 'temporary' ? Number(f.catalogId) : null,
        itemDescription: f.itemDescription.trim() || null,
        itemCode: f.itemCode.trim(), itemName: f.itemName.trim(), unitOfMeasureId: Number(f.unitOfMeasureId), quantity: Number(f.quantity), version });
      return line
        ? api(`/sales-contract-lines/${line.id}`, { method: 'PATCH', body })
        : api(`/sales-contracts/${contractId}/lines`, { method: 'POST', body });
    },
    onSuccess: onSaved,
  });
  const valid = (f.source === 'free' || f.catalogId) && f.itemCode.trim() && f.itemName.trim() && f.unitOfMeasureId && Number(f.quantity) > 0;
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  return (
    <FormDialog title={t(line ? 'sc.editItem' : 'sc.addItem')} submitLabel={t(line ? 'doc.saveEdit' : 'sc.saveItem')} error={save.error ?? uoms.error ?? (f.source === 'main' ? products.error : f.source === 'temporary' ? temporary.error : null)} pending={save.isPending}
      canSubmit={Boolean(valid)} onSubmit={() => save.mutate()} onClose={onClose} dirty={dirty} description={t('sc.lineDialogHint')}>
      {/* Layout rule: text fields take the full row; quantity and its unit share one row (read together, e.g. "4 Cái"). */}
      <TextField select label={t('prCatalog.source')} value={f.source}
        onChange={event => setF({ ...f, source: event.target.value, catalogId: '' })}>
        {['free', 'main', 'temporary'].map(source => <MenuItem key={source} value={source}>{t(`prCatalog.${source}`)}</MenuItem>)}
      </TextField>
      {f.source !== 'free' && <TextField select required label={t('prCatalog.item')} value={shownOptions.some(item => String(item.id) === f.catalogId) ? f.catalogId : ''}
        onChange={event => {
          const item = shownOptions.find(option => String(option.id) === event.target.value);
          if (!item) return;
          const sameSource = f.source === initial.source && event.target.value === initial.catalogId;
          setF({ ...f, catalogId: event.target.value, itemCode: sameSource ? initial.itemCode : item.code,
            itemName: sameSource ? initial.itemName : item.name, itemDescription: sameSource ? initial.itemDescription : item.description ?? '',
            unitOfMeasureId: sameSource && f.source === 'main' ? initial.unitOfMeasureId : item.uom ?? f.unitOfMeasureId });
        }}>
        {shownOptions.map(item => <MenuItem key={item.id} value={String(item.id)}>{item.code} - {item.name}</MenuItem>)}
      </TextField>}
      {duplicate && <Alert severity="warning">{t('prCatalog.duplicate')}</Alert>}
      <TextField label={t('sc.itemCode')} value={f.itemCode} onChange={set('itemCode')} disabled={f.source !== 'free'} required autoFocus />
      <TextField label={t('sc.itemName')} value={f.itemName} onChange={set('itemName')} disabled={f.source !== 'free'} required />
      <TextField label={t('prCatalog.description')} value={f.itemDescription} onChange={set('itemDescription')} disabled={f.source !== 'free'} multiline />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <TextField label={t('gr.quantity')} type="number" value={f.quantity} onChange={set('quantity')} required
          slotProps={{ htmlInput: { min: 0, step: 'any', inputMode: 'decimal' } }} />
        <TextField select label={t('sc.uom')} value={uoms.data?.some(uom => String(uom.id) === f.unitOfMeasureId) ? f.unitOfMeasureId : ''} onChange={set('unitOfMeasureId')} disabled={f.source === 'main'} required>
          {(uoms.data ?? []).map((u) => <MenuItem key={u.id} value={String(u.id)}>{u.name} ({u.code})</MenuItem>)}
        </TextField>
      </Box>
    </FormDialog>
  );
}
