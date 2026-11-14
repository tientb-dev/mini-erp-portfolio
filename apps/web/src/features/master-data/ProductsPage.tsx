import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ActiveChip, DataTable, FormDialog, ListPageLayout } from '../../shared/components';
import { Product, Uom } from './types';

export function ProductsPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products') });
  const columns: GridColDef<Product>[] = [
    { field: 'partNumber', headerName: t('product.partNumber'), flex: 1, minWidth: 150 },
    { field: 'name', headerName: t('product.name'), flex: 2, minWidth: 200 },
    { field: 'uom', headerName: t('product.uom'), width: 90, valueGetter: (_v, row) => row.unitOfMeasure.code },
    { field: 'isSerialTracked', headerName: t('product.isSerialTracked'), width: 120, valueFormatter: (v: boolean) => t(v ? 'common.yes' : 'common.no') },
    { field: 'isActive', headerName: t('common.status'), width: 130, renderCell: (p) => <ActiveChip active={p.value} /> },
  ];
  return (
    <>
      <ListPageLayout
        title={t('nav.products')} error={products.error}
        actions={<Button variant="contained" onClick={() => setOpen(true)}>{t('product.create')}</Button>}
      >
        <DataTable rows={products.data ?? []} columns={columns} loading={products.isLoading} emptyHint={t('product.empty')} />
      </ListPageLayout>
      {open && <ProductDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ProductDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const uoms = useQuery({ queryKey: ['uoms'], queryFn: () => api<Uom[]>('/units-of-measure') });
  const [form, setForm] = useState({ partNumber: '', name: '', unitOfMeasureId: '', isSerialTracked: true });
  const create = useMutation({
    mutationFn: () => api('/products', { method: 'POST', body: JSON.stringify({ ...form, unitOfMeasureId: Number(form.unitOfMeasureId) }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['products'] }); onClose(); },
  });
  return (
    <FormDialog
      title={t('product.create')} submitLabel={t('product.save')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(form.partNumber && form.name && form.unitOfMeasureId)} onSubmit={() => create.mutate()} onClose={onClose}
    >
      <TextField label={t('product.partNumber')} value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} required autoFocus />
      <TextField label={t('product.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <TextField select label={t('product.uom')} value={form.unitOfMeasureId} onChange={(e) => setForm({ ...form, unitOfMeasureId: e.target.value })} required>
        {(uoms.data ?? []).map((u) => <MenuItem key={u.id} value={u.id}>{u.code} — {u.name}</MenuItem>)}
      </TextField>
      <FormControlLabel
        control={<Checkbox checked={form.isSerialTracked} onChange={(e) => setForm({ ...form, isSerialTracked: e.target.checked })} />}
        label={t('product.isSerialTracked')}
      />
    </FormDialog>
  );
}
