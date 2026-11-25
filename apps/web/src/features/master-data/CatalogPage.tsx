import { useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Link, MenuItem, Snackbar, Stack, Switch, TextField, Tooltip } from '@mui/material';
import Add from '@mui/icons-material/Add';
import type { GridColDef } from '@mui/x-data-grid';
import { api, ApiError, catalogSelectionPath } from '../../services/api-client';
import { DataTable, DetailPageLayout, FilterToolbar, FormDialog, ListPageLayout } from '../../shared/components';
import { useMe } from '../identity';
import { CatalogEditor } from './CatalogEditor';
import { Catalog, displayDecimal, Entry, entryCode, label, statusLabel } from './catalogs';

export function CatalogPage({ catalog, initialId }: { catalog: Catalog; initialId?: number }) {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const permissions = useMe().data?.permissions ?? [];
  const path = `/${catalog.path}`;
  const { search } = useLocation();
  const listUrl = path + search;
  const catalogKey = [catalog.key === 'unitsOfMeasure' ? 'uoms' : catalog.path];
  const catalogQuery = useQuery({ queryKey: catalogKey, queryFn: () => api<Entry[]>(path) });
  const isProduct = catalog.key === 'products';
  const entry = catalogQuery.data?.find(row => row.id === initialId);
  const selecting = initialId !== undefined;
  const brands = useQuery({ queryKey: ['brands', selecting ? 'selection' : 'list', entry?.brandId],
    queryFn: () => api<Entry[]>(selecting ? catalogSelectionPath('/brands', entry?.brandId) : '/brands'), enabled: isProduct });
  const uoms = useQuery({ queryKey: ['uoms', selecting ? 'selection' : 'list', entry?.unitOfMeasureId],
    queryFn: () => api<Entry[]>(selecting ? catalogSelectionPath('/units-of-measure', entry?.unitOfMeasureId) : '/units-of-measure'), enabled: isProduct });
  const [confirmation, setConfirmation] = useState<Entry>();
  const [notice, setNotice] = useState<{ error: boolean; message: string }>();
  const [pending, setPending] = useState<number[]>([]);
  const qc = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api(`${path}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
    onMutate: ({ id }) => setPending(ids => [...ids, id]),
    onSuccess: async (_response, { id, isActive }) => {
      qc.setQueryData<Entry[]>(catalogKey, rows => rows?.map(row => row.id === id ? { ...row, isActive } : row));
      await qc.invalidateQueries({ queryKey: catalogKey });
      setConfirmation(previous => previous?.id === id ? undefined : previous);
      setNotice({ error: false, message: t('master.statusSaved') });
    },
    onError: (error, { id }) => {
      setConfirmation(previous => previous?.id === id ? undefined : previous);
      const reason = error instanceof ApiError ? t('master.statusErrors.' + error.code, { defaultValue: error.message }) : error.message;
      setNotice({ error: true, message: reason });
    },
    onSettled: (_data, _error, { id }) => setPending(ids => ids.filter(pendingId => pendingId !== id)),
  });
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const brand = params.get('brand') ?? '';
  const size = Number(params.get('size'));
  const pageSize = [25, 50, 100].includes(size) ? size : 25;
  const normalized = q.trim().toLocaleLowerCase();
  const filtered = (catalogQuery.data ?? []).filter(row =>
    (!normalized || [entryCode(row), row.name].some(value => value.toLocaleLowerCase().includes(normalized)))
    && (!status || String(row.isActive) === status) && (!brand || String(row.brandId) === brand));
  const page = Math.max(0, Math.min(Math.trunc(Number(params.get('page'))) || 0, Math.ceil(filtered.length / pageSize) - 1));
  const setFilter = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    return next;
  }, { replace: true });
  const title = t(`nav.${catalog.key}`);
  const canEdit = permissions.includes(catalog.update);
  const canCreate = permissions.includes(catalog.create);
  const columns: GridColDef<Entry>[] = [
    { field: isProduct ? 'partNumber' : 'code', headerName: label(t, isProduct ? 'partNumber' : 'code'), minWidth: 145, flex: 0.75,
      renderCell: ({ row, tabIndex }) => <CatalogRecordLink path={path} row={row} tabIndex={tabIndex} /> },
    { field: 'name', headerName: label(t, 'name'), flex: 1.5, minWidth: 200,
      renderCell: ({ row }) => <ClippedValue value={row.name} /> },
    ...(catalog.columns ?? []).map((field): GridColDef<Entry> => ({
      field, headerName: label(t, field), minWidth: 135, flex: 1,
      valueGetter: (_value, row) => {
        if (field === 'brandId') return brands.data?.find(item => item.id === row.brandId)?.name ?? '';
        if (field === 'unitOfMeasureId') return uoms.data?.find(item => item.id === row.unitOfMeasureId)?.code ?? '';
        return row[field];
      },
      valueFormatter: (value: string | number | boolean | null | undefined) => {
        if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
        if (typeof value === 'string' && (field === 'exchangeRate' || field === 'rate')) return displayDecimal(value, i18n.language);
        return value ?? '';
      },
      renderCell: ({ formattedValue }) => <ClippedValue value={String(formattedValue ?? '')} />,
    })),
  ];
  columns.push({
    field: 'isActive', headerName: t('common.status'), minWidth: 198, sortable: false,
    renderCell: ({ row, tabIndex }) => (
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', height: '100%' }}>
        <Switch size="small" checked={Boolean(row.isActive)} disabled={!canEdit || pending.includes(row.id)}
          slotProps={{ input: { role: 'switch', 'aria-label': `${t('common.status')} ${entryCode(row)}`, tabIndex } }}
          onChange={(_event, isActive) => isActive ? updateStatus.mutate({ id: row.id, isActive }) : setConfirmation(row)} />
        {statusLabel(t, Boolean(row.isActive))}
      </Stack>
    ),
  });
  const close = () => navigate(listUrl);
  const opened = initialId !== undefined;
  const editor = opened && (initialId === 0 && canCreate || entry) && (
    <CatalogEditor catalog={catalog} key={initialId} entry={entry} close={close} permissions={permissions}
      brands={brands} uoms={uoms} />
  );
  const missing = opened && !editor;
  if (catalog.fullPage && opened) return editor || (
    <DetailPageLayout title={title} loading={catalogQuery.isPending} error={catalogQuery.error} backTo={listUrl} naturalFlow>
      {t('common.notFound')}
    </DetailPageLayout>
  );
  return (
    <>
      <ListPageLayout title={title} error={catalogQuery.error ?? brands.error ?? uoms.error}
        actions={canCreate && <Button variant="contained" startIcon={<Add />} component={RouterLink} to={path + '/new' + search}>
          {t('master.create', { name: title.toLocaleLowerCase(i18n.language) })}
        </Button>}
        toolbar={<FilterToolbar active={Boolean(q || status || brand)} onClear={() => setParams({}, { replace: true })}>
          <TextField size="small" label={t('master.search')} value={q} onChange={event => setFilter('q', event.target.value)} sx={{ width: { xs: '100%', sm: 280 } }} />
          <TextField select size="small" label={t('common.status')} value={status || 'all'}
            onChange={event => setFilter('status', event.target.value === 'all' ? '' : event.target.value)} sx={{ width: { xs: '100%', sm: 180 } }}>
            <MenuItem value="all">{t('common.all')}</MenuItem>
            <MenuItem value="true">{statusLabel(t, true)}</MenuItem>
            <MenuItem value="false">{statusLabel(t, false)}</MenuItem>
          </TextField>
          {isProduct && <TextField select size="small" label={label(t, 'brandId')} value={brands.data?.some(item => String(item.id) === brand) ? brand : 'all'}
            onChange={event => setFilter('brand', event.target.value === 'all' ? '' : event.target.value)} sx={{ width: { xs: '100%', sm: 180 } }}>
            <MenuItem value="all">{t('common.all')}</MenuItem>
            {brands.data?.map(item => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
          </TextField>}
        </FilterToolbar>}>
        <DataTable rows={filtered} columns={columns} loading={catalogQuery.isPending} error={catalogQuery.error}
          paginationModel={{ page, pageSize }}
          onPaginationModelChange={model => {
            if (catalogQuery.isPending || (model.page === page && model.pageSize === pageSize)) return;
            setParams(previous => {
              const next = new URLSearchParams(previous);
              if (model.page) next.set('page', String(model.page)); else next.delete('page');
              if (model.pageSize !== 25) next.set('size', String(model.pageSize)); else next.delete('size');
              return next;
            }, { replace: true });
          }} />
      </ListPageLayout>
      {editor}
      {missing && !catalogQuery.isPending && <FormDialog title={title} pending={false} canSubmit={false}
        closeLabel={t('common.close')} error={catalogQuery.error} onSubmit={() => {}} onClose={close}>{t('common.notFound')}</FormDialog>}
      {confirmation && <FormDialog title={t('master.disableTitle', { code: entryCode(confirmation) })}
        submitLabel={t('master.disable')} pending={pending.includes(confirmation.id)}
        canSubmit error={null} onClose={() => setConfirmation(undefined)}
        onSubmit={() => updateStatus.mutate({ id: confirmation.id, isActive: false })}>
        {t('master.disableHint')}
      </FormDialog>}
      <Snackbar open={Boolean(notice)} autoHideDuration={notice?.error ? 6500 : 3500} onClose={() => setNotice(undefined)}>
        {notice && <Alert severity={notice.error ? 'error' : 'success'} onClose={() => setNotice(undefined)}>{notice.message}</Alert>}
      </Snackbar>
    </>
  );
}

function CatalogRecordLink({ path, row, tabIndex }: { path: string; row: Entry; tabIndex: number }) {
  const { search } = useLocation();
  return <Link component={RouterLink} to={path + '/' + row.id + search} tabIndex={tabIndex} sx={{ display: 'block' }}>
    <ClippedValue value={entryCode(row)} />
  </Link>;
}

function ClippedValue({ value }: { value: string }) {
  const [clipped, setClipped] = useState(false);
  return <Tooltip title={clipped ? value : ''}>
    <Box component="span" onMouseEnter={event => setClipped(event.currentTarget.scrollWidth > event.currentTarget.clientWidth)}
      sx={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{value}</Box>
  </Tooltip>;
}
