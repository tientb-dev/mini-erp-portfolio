import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel, Stack, TextField } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ActiveChip, DataTable, ErrorAlert, FormDialog, PageHeader } from '../../shared/components';
import { Warehouse } from './types';

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
