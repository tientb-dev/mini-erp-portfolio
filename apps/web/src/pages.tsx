import { FormEvent, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api, InventoryRow, Product, Uom, Warehouse } from './api';
import { ActiveChip, DataTable, ErrorAlert, PageHeader } from './ui';

/** Standard create/edit dialog: title, fields, Cancel + primary action; Enter submits. */
export function FormDialog(props: { title: string; submitLabel: string; error: unknown; pending: boolean; canSubmit: boolean; onSubmit: () => void; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const submit = (e: FormEvent) => { e.preventDefault(); if (props.canSubmit && !props.pending) props.onSubmit(); };
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm" slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
      <DialogTitle variant="h2">{props.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ErrorAlert error={props.error} />
          {props.children}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="contained" disabled={!props.canSubmit || props.pending}>{props.submitLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}

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
      <PageHeader title={t('nav.products')} action={<Button variant="contained" onClick={() => setOpen(true)}>{t('product.create')}</Button>} />
      <Stack spacing={2}>
        <ErrorAlert error={products.error} />
        <DataTable rows={products.data ?? []} columns={columns} loading={products.isLoading} emptyHint={t('product.empty')} />
      </Stack>
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

export function WarehousesPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses') });
  const columns: GridColDef<Warehouse>[] = [
    { field: 'code', headerName: t('warehouse.code'), width: 140 },
    { field: 'name', headerName: t('warehouse.name'), flex: 1, minWidth: 200 },
    {
      field: 'allowAvailableStockIssue', headerName: t('warehouse.allowAvailableStockIssue'), width: 220,
      valueFormatter: (v: boolean) => t(v ? 'common.yes' : 'common.no'),
    },
    { field: 'isActive', headerName: t('common.status'), width: 130, renderCell: (p) => <ActiveChip active={p.value} /> },
  ];
  return (
    <>
      <PageHeader title={t('nav.warehouses')} action={<Button variant="contained" onClick={() => setOpen(true)}>{t('warehouse.create')}</Button>} />
      <Stack spacing={2}>
        <ErrorAlert error={warehouses.error} />
        <DataTable rows={warehouses.data ?? []} columns={columns} loading={warehouses.isLoading} emptyHint={t('warehouse.empty')} />
      </Stack>
      {open && <WarehouseDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function WarehouseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '', allowAvailableStockIssue: false });
  const create = useMutation({
    mutationFn: () => api('/warehouses', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['warehouses'] }); onClose(); },
  });
  return (
    <FormDialog
      title={t('warehouse.create')} submitLabel={t('warehouse.save')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(form.code && form.name)} onSubmit={() => create.mutate()} onClose={onClose}
    >
      <TextField label={t('warehouse.code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required autoFocus />
      <TextField label={t('warehouse.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <FormControlLabel
        control={<Checkbox checked={form.allowAvailableStockIssue} onChange={(e) => setForm({ ...form, allowAvailableStockIssue: e.target.checked })} />}
        label={t('warehouse.allowAvailableStockIssue')}
      />
    </FormDialog>
  );
}

export function InventoryPage() {
  const { t } = useTranslation();
  const inventory = useQuery({ queryKey: ['inventories'], queryFn: () => api<InventoryRow[]>('/inventories') });
  const qty = { type: 'number' as const, width: 130, valueGetter: (v: string) => Number(v) };
  const columns: GridColDef<InventoryRow>[] = [
    { field: 'warehouse', headerName: t('inventory.warehouse'), width: 110, valueGetter: (_v, r) => r.warehouse.code },
    { field: 'partNumber', headerName: t('product.partNumber'), width: 170, valueGetter: (_v, r) => r.product.partNumber },
    { field: 'name', headerName: t('product.name'), flex: 1, minWidth: 200, valueGetter: (_v, r) => r.product.name },
    { field: 'uom', headerName: t('product.uom'), width: 80, valueGetter: (_v, r) => r.product.uom },
    { field: 'onHandQuantity', headerName: t('inventory.onHand'), ...qty },
    { field: 'reservedQuantity', headerName: t('inventory.reserved'), ...qty },
    { field: 'availableQuantity', headerName: t('inventory.available'), ...qty, cellClassName: () => 'qty-available' },
  ];
  return (
    <>
      <PageHeader title={t('nav.inventory')} />
      <Stack spacing={2}>
        <ErrorAlert error={inventory.error} />
        <DataTable
          rows={inventory.data ?? []} columns={columns} loading={inventory.isLoading} emptyHint={t('inventory.empty')}
          sx={{ '& .qty-available': { fontWeight: 600 } }}
        />
      </Stack>
    </>
  );
}

/** Customers and suppliers: code + name only (MVP). */
function PartyPage({ kind }: { kind: 'customers' | 'suppliers' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '' });
  const list = useQuery({ queryKey: [kind], queryFn: () => api<{ id: number; code: string; name: string }[]>(`/${kind}`) });
  const create = useMutation({
    mutationFn: () => api(`/${kind}`, { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [kind] }); setOpen(false); setForm({ code: '', name: '' }); },
  });
  const columns: GridColDef[] = [
    { field: 'code', headerName: t('party.code'), width: 160 },
    { field: 'name', headerName: t('party.name'), flex: 1, minWidth: 200 },
  ];
  return (
    <>
      <PageHeader title={t(`nav.${kind}`)} action={<Button variant="contained" onClick={() => setOpen(true)}>{t(`party.create.${kind}`)}</Button>} />
      <Stack spacing={2}>
        <ErrorAlert error={list.error} />
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t(`party.empty.${kind}`)} />
      </Stack>
      {open && (
        <FormDialog title={t(`party.create.${kind}`)} submitLabel={t('party.save')} error={create.error} pending={create.isPending}
          canSubmit={Boolean(form.code.trim() && form.name.trim())} onSubmit={() => create.mutate()} onClose={() => setOpen(false)}>
          <TextField label={t('party.code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required autoFocus />
          <TextField label={t('party.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </FormDialog>
      )}
    </>
  );
}

export const CustomersPage = () => <PartyPage kind="customers" />;
export const SuppliersPage = () => <PartyPage kind="suppliers" />;
