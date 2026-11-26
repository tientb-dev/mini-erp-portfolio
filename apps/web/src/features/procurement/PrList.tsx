import { useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Tooltip } from '@mui/material';
import Refresh from '@mui/icons-material/Refresh';
import Add from '@mui/icons-material/Add';
import { SearchInput } from '../../shared/components/SearchInput';
import { GridColDef } from '@mui/x-data-grid';
import { ApprovalStatusChip, DataTable, FilterToolbar, GridText, ListPageLayout } from '../../shared/components';
import { DocumentDatePicker } from '../../shared/components/DocumentDatePicker';
import { formatDocumentDate } from '../../shared/utils/document-date';
import { useDebouncedText, useServerList } from '../../shared/utils/server-list';
import { useMe } from '../identity';
import { DocRow } from './types';
import { formatDocumentAmount } from '../../shared/utils/document-money';

const statuses = ['DRAFT','WAITING_FOR_APPROVE','WAITING_FOR_RECEIPT','DONE','REJECTED','CANCELED'];
export function PrList() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  latestParams.current = params;
  const [dateReset, setDateReset] = useState(0);
  const q = params.get('q') ?? '';
  const delayed = useDebouncedText(q);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const invalid = Boolean(from && to && from > to);
  const sort = params.get('sort');
  const direction = params.get('direction') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(0, Number(params.get('page') ?? 1) - 1) || 0;
  const size = Number(params.get('size'));
  const pageSize = [25,50,100].includes(size) ? size : 25;
  const query = new URLSearchParams();
  for (const key of ['category','status','from','to','sort','direction']) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  if (delayed && q) query.set('q', delayed);
  if (params.has('mine')) query.set('assignedToMe', 'true');
  query.set('page', String(page + 1));
  query.set('size', String(pageSize));
  const list = useServerList<DocRow>('/purchase-requisitions', query, !invalid && q === delayed && Boolean(me.data));
  function update(fields: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(latestParams.current);
    if (resetPage) next.delete('page');
    for (const [key, value] of Object.entries(fields)) value ? next.set(key, value) : next.delete(key);
    latestParams.current = next;
    setParams(next, { replace: true });
  }
  const columns: GridColDef<DocRow>[] = [
    { field: 'documentNumber', headerName: t('prPhase.number'), width: 158, renderCell: p =>
      <GridText value={p.value} to={`/purchase-requisitions/${p.id}?${params}`} tabIndex={p.tabIndex} /> },
    { field: 'name', headerName: t('prPhase.name'), width: 195 },
    { field: 'category', headerName: t('pr.category'), width: 112, valueFormatter: v => t(`category.${v}`, { defaultValue: String(v ?? '') }) },
    { field: 'salesContractNumber', headerName: t('gir.salesContract'), width: 155 },
    { field: 'customerName', headerName: t('sc.customer'), width: 170 },
    { field: 'requesterName', headerName: t('pr.requester'), width: 155 },
    { field: 'requisitionDate', headerName: t('prPhase.requisitionDate'), width: 138, valueFormatter: value => formatDocumentDate(String(value ?? ''), i18n.language) },
    { field: 'requiredDate', headerName: t('prPhase.requiredDate'), width: 140, valueFormatter: value => formatDocumentDate(String(value ?? ''), i18n.language) },
    { field: 'total', headerName: t('prPhase.total'), width: 150, align: 'right', headerAlign: 'right', sortable: false,
      renderCell: p => formatDocumentAmount(p.value, Number(p.row.currencyDecimalPlaces ?? 0), i18n.language) },
    { field: 'currencyCode', headerName: t('prPhase.currency'), width: 110 },
    { field: 'approvalStatus', headerName: t('common.status'), width: 155, renderCell: p => <ApprovalStatusChip status={p.value} /> },
    { field: 'assignedApproverName', headerName: t('prPhase.handler'), width: 170 },
  ];
  function date(key: 'from' | 'to') {
    return <DocumentDatePicker key={key + dateReset} label={t(`prPhase.${key}`)} value={params.get(key) ?? ''} error={invalid}
      onChange={value => update({ [key]: value })} sx={{ width: 160 }} />;
  }
  return <ListPageLayout title={t('pr.title')} error={invalid ? new Error(t('prPhase.invalidRange')) : list.error}
    actions={me.data?.permissions.includes('PR.CREATE') && <Button component={Link} to={`/purchase-requisitions/new?${params}`} variant="contained" startIcon={<Add />}>{t('pr.create')}</Button>}
    toolbar={<FilterToolbar>
      <Stack spacing={1.5} sx={{ width: '100%' }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <SearchInput label={t('common.search')} placeholder={t('searchFields.pr')} value={q} maxLength={200}
            onChange={value => update({ q: value })} sx={{ flex: '2 1 220px', minWidth: 0 }} />
          <TextField select size="small" label={t('pr.category')} value={params.get('category') ?? 'all'} onChange={e => update({ category: e.target.value === 'all' ? '' : e.target.value })} sx={{ flex: '1 1 145px', minWidth: 0 }}>
            <MenuItem value="all">{t('common.all')}</MenuItem>
            {['SALES_GOODS','MATERIAL'].map(value => <MenuItem key={value} value={value}>{t(`category.${value}`)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={t('common.status')} value={params.get('status') ?? 'all'} onChange={e => update({ status: e.target.value === 'all' ? '' : e.target.value })} sx={{ flex: '1 1 145px', minWidth: 0 }}>
            <MenuItem value="all">{t('common.all')}</MenuItem>
            {statuses.map(value => <MenuItem key={value} value={value}><ApprovalStatusChip status={value} /></MenuItem>)}
          </TextField>
          <FormControlLabel sx={{ m: 0, height: 40, flex: 'none' }} control={<Checkbox checked={params.has('mine')}
            onChange={e => update({ mine: e.target.checked ? 'true' : '' })} />} label={t('prPhase.waiting')} />
        </Stack>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {date('from')}{date('to')}
          <Tooltip title={t('prPhase.refreshHint')}><Button sx={{ ml: 'auto', bgcolor: 'background.paper', minHeight: 36 }} variant="outlined" startIcon={<Refresh />}
            onClick={() => { setDateReset(n => n + 1); if (!params.size) void list.refetch(); setParams({}, { replace: true }); }}>{t('prPhase.refresh')}</Button></Tooltip>
        </Stack>
      </Stack>
    </FilterToolbar>}>
    <DataTable rows={invalid ? [] : list.data?.items ?? []} columns={columns} loading={list.isFetching || q !== delayed}
      maxHeight="clamp(320px, calc(100dvh - 270px), 760px)" rowCount={invalid ? 0 : list.data?.total ?? 0}
      paginationMode="server" sortingMode="server" sortingOrder={['asc', 'desc']} paginationModel={{ page, pageSize }}
      sortModel={sort ? [{ field: sort, sort: direction }] : []}
      onSortModelChange={model => update({ sort: model[0]?.field ?? '', direction: model[0]?.sort ?? '' })}
      onPaginationModelChange={model => {
        if (model.page !== page || model.pageSize !== pageSize) update({ page: String(model.page + 1), size: String(model.pageSize) }, false);
      }} />
  </ListPageLayout>;
}
