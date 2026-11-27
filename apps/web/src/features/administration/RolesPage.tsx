import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconButton, MenuItem, Stack, TextField, Tooltip } from '@mui/material';
import Edit from '@mui/icons-material/EditOutlined';
import Copy from '@mui/icons-material/ContentCopyOutlined';
import type { GridColDef, GridSortDirection } from '@mui/x-data-grid';
import { useMemo } from 'react';
import { ActiveChip, DataTable, FilterToolbar, GridText, ListPageLayout } from '../../shared/components';
import { ActionButton } from '../../shared/components/ActionButton';
import { SearchInput } from '../../shared/components/SearchInput';
import { useDebouncedText, useServerList } from '../../shared/utils/server-list';
import { useMe } from '../identity';
import type { RoleRow } from './api';
import { RoleDetailPage } from './RoleDetail';

const SORTABLE = ['code', 'name', 'userCount', 'permissionCount', 'isActive'];

/** Vai trò & Phân quyền (OA1.3): server-side list; `/roles/:id` opens the full-page detail, keeping the list state in the URL. */
export function RolesPage({ initialId }: { initialId?: number }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { search, state } = useLocation();
  const canManage = Boolean(useMe().data?.permissions.includes('ROLE.MANAGE'));
  const listParams = new URLSearchParams(search);
  listParams.delete('mode');
  listParams.delete('copy');
  const listSearch = listParams.size ? '?' + listParams : '';
  const q = params.get('q') ?? '';
  const debounced = useDebouncedText(q);
  const status = params.get('status') ?? '';
  const sort = SORTABLE.includes(params.get('sort') ?? '') ? params.get('sort')! : 'code';
  const direction = params.get('direction') === 'desc' ? 'desc' : 'asc';
  const size = [25, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 25;
  const page = Math.max(0, Math.trunc(Number(params.get('page'))) || 0);
  const apiParams = new URLSearchParams({ sort, direction, size: String(size), page: String(page) });
  if (debounced.trim()) apiParams.set('q', debounced.trim());
  if (status) apiParams.set('status', status);
  // Stable references (FRONTEND.md): new objects each render read as a sort change and reset the grid to page 1.
  const sortModel = useMemo(() => [{ field: sort, sort: direction as GridSortDirection }], [sort, direction]);
  const paginationModel = useMemo(() => ({ page, pageSize: size }), [page, size]);
  const list = useServerList<RoleRow>('/admin/roles', apiParams, initialId === undefined);

  if (initialId !== undefined) {
    // Back returns to the list exactly as it was (filters, sort, page), from a list link or a direct URL.
    const backTo = '/roles' + (typeof state?.listSearch === 'string' ? state.listSearch : listSearch);
    return <RoleDetailPage key={`${initialId}:${params.get('copy') ?? ''}`} id={initialId} copyId={Number(params.get('copy')) || undefined}
      startEditing={params.get('mode') === 'edit'} backTo={backTo} />;
  }
  const open = (url: string) => navigate(url, { state: { listSearch } });
  const set = (changes: Record<string, string>) => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const columns: GridColDef<RoleRow>[] = [
    { field: 'code', headerName: t('roles.code'), minWidth: 150, flex: 0.8,
      renderCell: ({ row, tabIndex }) => <GridText to={`/roles/${row.id}`} linkState={{ listSearch }} tabIndex={tabIndex} value={row.code} /> },
    { field: 'name', headerName: t('roles.name'), minWidth: 180, flex: 1.2 },
    { field: 'description', headerName: t('roles.description'), minWidth: 200, flex: 1.5, sortable: false },
    { field: 'userCount', headerName: t('roles.userCount'), type: 'number', width: 130 },
    { field: 'permissionCount', headerName: t('roles.permissionCount'), type: 'number', width: 120 },
    { field: 'isActive', headerName: t('common.status'), width: 140, renderCell: ({ row }) => <ActiveChip active={row.isActive} /> },
  ];
  if (canManage) columns.push({
    field: 'actions', headerName: t('common.actions'), width: 96, sortable: false, align: 'center',
    renderCell: ({ row, tabIndex }) => <Stack direction="row" sx={{ alignItems: 'center', height: '100%' }}>
      <Tooltip title={t('roles.edit')}><IconButton size="small" color="primary" tabIndex={tabIndex} aria-label={`${t('roles.edit')} ${row.code}`}
        onClick={() => open(`/roles/${row.id}?mode=edit`)}><Edit fontSize="small" /></IconButton></Tooltip>
      {!row.isSystem && <Tooltip title={t('roles.copy')}><IconButton size="small" color="primary" tabIndex={tabIndex} aria-label={`${t('roles.copy')} ${row.code}`}
        onClick={() => open(`/roles/new?copy=${row.id}`)}><Copy fontSize="small" /></IconButton></Tooltip>}
    </Stack>,
  });
  return (
    <ListPageLayout title={t('nav.roles')} error={list.error}
      actions={canManage && <ActionButton action="add" onClick={() => open('/roles/new')}>{t('roles.create')}</ActionButton>}
      toolbar={<FilterToolbar refreshing={list.isFetching}
        onRefresh={() => { set({ q: '', status: '', sort: '', direction: '', page: '' }); void list.refetch(); }}>
        <SearchInput label={t('common.search')} placeholder={t('roles.searchHint')} value={q} onChange={value => set({ q: value, page: '' })}
          sx={{ flex: { xs: '1 1 100%', sm: '0 1 420px' }, minWidth: 0 }} />
        <TextField select size="small" label={t('common.status')} value={status || 'all'} sx={{ width: { xs: '100%', sm: 180 } }}
          onChange={event => set({ status: event.target.value === 'all' ? '' : event.target.value, page: '' })}>
          <MenuItem value="all">{t('common.all')}</MenuItem>
          <MenuItem value="true">{t('common.active')}</MenuItem>
          <MenuItem value="false">{t('common.inactive')}</MenuItem>
        </TextField>
      </FilterToolbar>}>
      <DataTable rows={list.data?.items ?? []} rowCount={list.data?.total ?? 0} columns={columns} loading={list.isFetching} error={list.error}
        paginationMode="server" sortingMode="server" emptyHint={t('roles.empty')}
        sortModel={sortModel}
        onSortModelChange={model => set({ sort: model[0]?.field ?? '', direction: model[0]?.sort ?? '', page: '' })}
        paginationModel={paginationModel}
        onPaginationModelChange={model => set({ page: model.page ? String(model.page) : '', size: model.pageSize !== 25 ? String(model.pageSize) : '' })} />
    </ListPageLayout>
  );
}
