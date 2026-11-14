import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Stack, TextField } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { DataTable, ErrorAlert, FormDialog, PageHeader } from '../../shared/components';

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
