import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ActiveChip, DataTable, FormDialog, ListPageLayout } from '../../shared/components';
import { useMe } from '../identity';
import { Product, Uom } from './types';

export function ProductsPage() {
  const { t } = useTranslation();
  const permissions = useMe().data?.permissions ?? [];
  const canCreate = permissions.includes('PRODUCT.CREATE');
  const [editingBrand, setEditingBrand] = useState<Product>();
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api<{ id: number; name: string }[]>('/brands') });
  const [open, setOpen] = useState(false);
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products') });
  const columns: GridColDef<Product>[] = [
    { field: 'partNumber', headerName: t('product.partNumber'), flex: 1, minWidth: 150 },
    { field: 'name', headerName: t('product.name'), flex: 2, minWidth: 200 },
    { field: 'brandId', headerName: t('prCatalog.brand'), minWidth: 140, valueFormatter: (id: number) => brands.data?.find(brand => brand.id === id)?.name ?? '' },
    { field: 'uom', headerName: t('product.uom'), width: 90, valueGetter: (_v, row) => row.unitOfMeasure.code },
    { field: 'isSerialTracked', headerName: t('product.isSerialTracked'), width: 120, valueFormatter: (v: boolean) => t(v ? 'common.yes' : 'common.no') },
    { field: 'isActive', headerName: t('common.status'), width: 130, renderCell: (p) => <ActiveChip active={p.value} /> },
  ];
  if (permissions.includes('PRODUCT.UPDATE')) columns.push({
    field: 'actions', headerName: t('common.actions'), width: 150, sortable: false,
    renderCell: ({ row }) => <Button onClick={() => setEditingBrand(row)}>{t('prCatalog.changeBrand')}</Button>,
  });
  return (
    <>
      <ListPageLayout
        title={t('nav.products')} error={products.error ?? brands.error}
        actions={canCreate && <Button variant="contained" onClick={() => setOpen(true)}>{t('product.create')}</Button>}
      >
        <DataTable rows={products.data ?? []} columns={columns} loading={products.isLoading} emptyHint={t('product.empty')} />
      </ListPageLayout>
      {editingBrand && <ChangeBrandDialog product={editingBrand} brands={brands.data ?? []} onClose={() => setEditingBrand(undefined)} />}
      {open && <ProductDialog brands={brands.data ?? []} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangeBrandDialog({ product, brands, onClose }: {
  product: Product; brands: { id: number; name: string }[]; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [brandId, setBrandId] = useState(String(product.brandId ?? ''));
  const save = useMutation({
    mutationFn: () => api(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ brandId: Number(brandId) }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['products'] }); onClose(); },
  });
  return <FormDialog title={t('prCatalog.changeBrand')} submitLabel={t('prCatalog.save')} error={save.error}
    pending={save.isPending} canSubmit={Boolean(brandId) && Number(brandId) !== product.brandId}
    onClose={onClose} onSubmit={() => save.mutate()}>
    <TextField select label={t('prCatalog.brand')} value={brandId} onChange={e => setBrandId(e.target.value)} required>
      {brands.map(brand => <MenuItem key={brand.id} value={String(brand.id)}>{brand.name}</MenuItem>)}
    </TextField>
  </FormDialog>;
}

function ProductDialog({ brands, onClose }: { brands: { id: number; name: string }[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const uoms = useQuery({ queryKey: ['uoms'], queryFn: () => api<Uom[]>('/units-of-measure') });
  const [form, setForm] = useState({ partNumber: '', name: '', unitOfMeasureId: '', brandId: '', isSerialTracked: true });
  const create = useMutation({
    mutationFn: () => api('/products', { method: 'POST', body: JSON.stringify({ ...form, brandId: Number(form.brandId), unitOfMeasureId: Number(form.unitOfMeasureId) }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['products'] }); onClose(); },
  });
  return (
    <FormDialog
      title={t('product.create')} submitLabel={t('product.save')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(form.partNumber && form.name && form.brandId && form.unitOfMeasureId)} onSubmit={() => create.mutate()} onClose={onClose}
    >
      <TextField label={t('product.partNumber')} value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} required autoFocus />
      <TextField label={t('product.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <TextField select label={t('prCatalog.brand')} value={form.brandId} onChange={e => setForm({ ...form, brandId: e.target.value })} required>
        {brands.map(brand => <MenuItem key={brand.id} value={String(brand.id)}>{brand.name}</MenuItem>)}
      </TextField>
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
