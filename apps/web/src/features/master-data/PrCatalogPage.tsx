import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, IconButton, MenuItem, Stack, Tab, Tabs, TextField, Tooltip } from '@mui/material';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import { api } from '../../services/api-client';
import { DataTable, FormDialog, ListPageLayout } from '../../shared/components';
import { useMe } from '../identity';

type Catalog = 'brands' | 'temporary-products' | 'currencies' | 'tax-rates';
interface Entry {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  exchangeRate?: string;
  decimalPlaces?: number;
  rate?: string;
}

const catalogs: Catalog[] = ['brands', 'temporary-products', 'currencies', 'tax-rates'];
const extraFields = {
  brands: [],
  'temporary-products': ['description'],
  currencies: ['exchangeRate', 'decimalPlaces'],
  'tax-rates': ['rate'],
} as const;

export function PrCatalogPage() {
  const { t } = useTranslation();
  const permissions = useMe().data?.permissions ?? [];
  const canManage = permissions.includes('PROCUREMENT_CATALOG.MANAGE');
  const [catalog, setCatalog] = useState<Catalog>('brands');
  const [editor, setEditor] = useState<Entry | 'new'>();
  const [deleting, setDeleting] = useState<Entry>();
  const [brand, setBrand] = useState<Entry>();
  const list = useQuery({ queryKey: [catalog], queryFn: () => api<Entry[]>(`/${catalog}`) });
  return (
    <ListPageLayout title={t('nav.prCatalog')} error={list.error}
      actions={canManage && <Button variant="contained" onClick={() => setEditor('new')}>{t('prCatalog.add')}</Button>}
      toolbar={<Tabs value={catalog} onChange={(_event, value: Catalog) => setCatalog(value)} variant="scrollable">
        {catalogs.map(key => <Tab key={key} value={key} label={t(`prCatalog.${key}`)} />)}
      </Tabs>}>
      <DataTable rows={list.data ?? []} loading={list.isLoading} columns={[
        { field: 'code', headerName: t('prCatalog.code'), minWidth: 110 },
        { field: 'name', headerName: t('prCatalog.name'), minWidth: 180, flex: 1 },
        ...extraFields[catalog].map(field => ({ field, headerName: t(`prCatalog.${field}`), minWidth: 150, flex: 1 })),
        ...(canManage || (catalog === 'brands' && permissions.includes('SUPPLIER.VIEW')) ? [{
          field: 'actions', headerName: t('common.actions'), sortable: false, width: 140,
          renderCell: ({ row }: { row: Entry }) => (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
              {canManage && <Tooltip title={t('prCatalog.edit')}>
                <IconButton size="small" aria-label={t('prCatalog.edit')} onClick={() => setEditor(row)}><EditOutlined fontSize="small" /></IconButton>
              </Tooltip>}
              {canManage && !(catalog === 'currencies' && row.code === 'VND') && <Tooltip title={t('prCatalog.delete')}>
                <IconButton size="small" color="error" aria-label={t('prCatalog.delete')} onClick={() => setDeleting(row)}><DeleteOutline fontSize="small" /></IconButton>
              </Tooltip>}
              {catalog === 'brands' && permissions.includes('SUPPLIER.VIEW') && <Tooltip title={t('prCatalog.suppliers')}>
                <IconButton size="small" aria-label={t('prCatalog.suppliers')} onClick={() => setBrand(row)}><LocalShippingOutlined fontSize="small" /></IconButton>
              </Tooltip>}
            </Stack>
          ),
        }] : []),
      ]} />
      {editor && <CatalogDialog catalog={catalog} entry={editor === 'new' ? undefined : editor} close={() => setEditor(undefined)} />}
      {deleting && <DeleteCatalogDialog catalog={catalog} entry={deleting} close={() => setDeleting(undefined)} />}
      {brand && <BrandSuppliersDialog brand={brand} editable={canManage} close={() => setBrand(undefined)} />}
    </ListPageLayout>
  );
}

function DeleteCatalogDialog({ catalog, entry, close }: { catalog: Catalog; entry: Entry; close: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/${catalog}/${entry.id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [catalog] }); close(); },
  });
  return <FormDialog title={t('prCatalog.deleteEntry', { name: entry.name })} submitLabel={t('prCatalog.delete')}
    submitColor="error" pending={remove.isPending} error={remove.error} canSubmit onClose={close} onSubmit={() => remove.mutate()}>{null}</FormDialog>;
}

function CatalogDialog({ catalog, entry, close }: { catalog: Catalog; entry?: Entry; close: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fields, setFields] = useState({
    code: entry?.code ?? '', name: entry?.name ?? '', description: entry?.description ?? '',
    exchangeRate: entry?.exchangeRate ?? '', decimalPlaces: String(entry?.decimalPlaces ?? 0), rate: entry?.rate ?? '0',
  });
  const fieldsShown = ['code', 'name', ...extraFields[catalog]] as const;
  const vnd = catalog === 'currencies' && fields.code === 'VND';
  const save = useMutation({
    mutationFn: () => api(`/${catalog}${entry ? `/${entry.id}` : ''}`, {
      method: entry ? 'PATCH' : 'POST',
      body: JSON.stringify(Object.fromEntries(fieldsShown.map(field => [
        field, field === 'decimalPlaces' ? Number(fields[field]) : field === 'exchangeRate' && vnd ? '1' : fields[field],
      ]))),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [catalog] }); close(); },
  });
  return <FormDialog title={t(entry ? 'prCatalog.edit' : 'prCatalog.add')} submitLabel={t('prCatalog.save')}
    error={save.error} pending={save.isPending} canSubmit={fieldsShown.every(field =>
      field === 'description' || (field === 'exchangeRate' && vnd) || Boolean(fields[field].trim()))}
    onClose={close} onSubmit={() => save.mutate()}>
    {fieldsShown.map(field => <TextField key={field} label={t(`prCatalog.${field}`)}
      value={vnd && field === 'exchangeRate' ? '1' : fields[field]} multiline={field === 'description'}
      disabled={vnd && field === 'exchangeRate' || entry?.code === 'VND' && field === 'code'}
      required={field !== 'description'} onChange={event => setFields({ ...fields, [field]: event.target.value })} />)}
  </FormDialog>;
}

function BrandSuppliersDialog({ brand, editable, close }: { brand: Entry; editable: boolean; close: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const path = `/brands/${brand.id}/suppliers`;
  const linked = useQuery({ queryKey: [path], queryFn: () => api<Entry[]>(path) });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Entry[]>('/suppliers'), enabled: editable });
  const [selection, setSelection] = useState<number[]>();
  const ids = selection ?? linked.data?.map(entry => entry.id) ?? [];
  const save = useMutation({
    mutationFn: () => api(path, { method: 'PUT', body: JSON.stringify({ supplierIds: ids }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [path] }); close(); },
  });
  return <FormDialog title={`${t('prCatalog.suppliers')} · ${brand.name}`}
    submitLabel={t(editable ? 'prCatalog.save' : 'prCatalog.close')} error={save.error ?? linked.error ?? suppliers.error}
    pending={save.isPending} canSubmit={!editable || linked.isSuccess && suppliers.isSuccess}
    onClose={close} onSubmit={() => editable ? save.mutate() : close()}>
    {editable ? <TextField select label={t('prCatalog.suppliers')} value={suppliers.isSuccess ? ids : []}
      disabled={!linked.isSuccess || !suppliers.isSuccess}
      slotProps={{ select: { multiple: true } }}
      onChange={event => setSelection(Array.isArray(event.target.value) ? event.target.value.map(Number) : [])}>
      {(suppliers.data ?? []).map(supplier => <MenuItem key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</MenuItem>)}
    </TextField> : <DataTable hideFooter rows={linked.data ?? []} loading={linked.isLoading}
      columns={[{ field: 'code', headerName: t('prCatalog.code') }, { field: 'name', headerName: t('prCatalog.name'), flex: 1 }]} />}
  </FormDialog>;
}
