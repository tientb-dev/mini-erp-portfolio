import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import Edit from '@mui/icons-material/EditOutlined';
import type { GridColDef, GridSortDirection } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { DataTable, FilterToolbar, GridText, ListPageLayout } from '../../shared/components';
import { ActionButton } from '../../shared/components/ActionButton';
import { SearchInput } from '../../shared/components/SearchInput';
import { useDebouncedText, useServerList } from '../../shared/utils/server-list';
import { useMe } from '../identity';
import { AccountChip, EmploymentChip } from './UserChips';
import { ServerAutocomplete } from './ServerAutocomplete';
import { UserDetailPage } from './UserDetail';
import { Ref, refLabel, USERS, useOrgTree, UserRow } from './users-api';

const SORTABLE = ['employeeCode', 'fullName', 'username', 'employmentStatus', 'accountStatus'];
const FILTERS = ['q', 'orgUnitId', 'roleId', 'employmentStatus', 'accountStatus'] as const;

/** Người dùng (BA-UI-04, §9): server-side list; `/users/:id` and `/users/new` open the full page, the list state stays in the URL. */
export function UsersPage({ initialId }: { initialId?: number }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { search, state } = useLocation();
  const canManage = Boolean(useMe().data?.permissions.includes('USER.MANAGE'));
  const listParams = new URLSearchParams(search);
  listParams.delete('mode');
  const listSearch = listParams.size ? '?' + listParams : '';
  const value = (key: string) => params.get(key) ?? '';
  const debounced = useDebouncedText(value('q'));
  const sort = SORTABLE.includes(value('sort')) ? value('sort') : 'employeeCode';
  const direction = value('direction') === 'desc' ? 'desc' : 'asc';
  const size = [25, 50, 100].includes(Number(value('size'))) ? Number(value('size')) : 25;
  const page = Math.max(0, Math.trunc(Number(value('page'))) || 0);
  const apiParams = new URLSearchParams({ sort, direction, size: String(size), page: String(page) });
  for (const key of FILTERS) if (key !== 'q' && value(key)) apiParams.set(key, value(key));
  if (debounced.trim()) apiParams.set('q', debounced.trim());
  const sortModel = useMemo(() => [{ field: sort, sort: direction as GridSortDirection }], [sort, direction]);
  const paginationModel = useMemo(() => ({ page, pageSize: size }), [page, size]);
  const list = useServerList<UserRow>(USERS, apiParams, initialId === undefined);
  const tree = useOrgTree();
  // The role filter searches roles on the server (no cap); the chosen role's label comes from its own record.
  const roleId = Number(value('roleId')) || 0;
  const role = useQuery({ queryKey: ['/admin/roles', 'filter-label', roleId], enabled: roleId > 0 && initialId === undefined,
    queryFn: () => api<Ref>(`/admin/roles/${roleId}`) });

  if (initialId !== undefined) {
    const backTo = '/users' + (typeof state?.listSearch === 'string' ? state.listSearch : listSearch);
    return <UserDetailPage key={initialId} id={initialId} startEditing={params.get('mode') === 'edit'} backTo={backTo} />;
  }
  const open = (url: string) => navigate(url, { state: { listSearch } });
  const set = (changes: Record<string, string>) => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const [key, v] of Object.entries(changes)) if (v) next.set(key, v); else next.delete(key);
    return next;
  }, { replace: true });
  const ref = (r: Ref | null) => (r ? refLabel(r) : '—');
  // F01: identity, organization and both statuses first; contact columns last (the grid scrolls sideways, columns keep their width).
  const columns: GridColDef<UserRow>[] = [
    { field: 'employeeCode', headerName: t('users.employeeCodeShort'), width: 110,
      renderCell: ({ row, tabIndex }) => <GridText to={`/users/${row.id}`} linkState={{ listSearch }} tabIndex={tabIndex} value={row.employeeCode} /> },
    { field: 'fullName', headerName: t('users.fullName'), minWidth: 170, flex: 1, renderCell: ({ row }) => <GridText value={row.fullName} /> },
    { field: 'username', headerName: t('users.username'), width: 140, renderCell: ({ row }) => <GridText value={row.username ?? '—'} /> },
    { field: 'primaryOrgUnit', headerName: t('users.primaryOrgUnit'), minWidth: 170, flex: 1, sortable: false,
      renderCell: ({ row }) => <GridText value={ref(row.primaryOrgUnit)} /> },
    { field: 'primaryJobTitle', headerName: t('users.primaryJobTitle'), width: 150, sortable: false,
      renderCell: ({ row }) => <GridText value={row.primaryJobTitle?.name ?? '—'} /> },
    { field: 'employmentStatus', headerName: t('users.employmentStatus'), width: 150, renderCell: ({ row }) => <EmploymentChip status={row.employmentStatus} /> },
    { field: 'accountStatus', headerName: t('users.accountStatus'), width: 150, renderCell: ({ row }) => <AccountChip status={row.accountStatus} /> },
    { field: 'email', headerName: t('users.email'), width: 190, sortable: false, renderCell: ({ row }) => <GridText value={row.email ?? '—'} /> },
    { field: 'phone', headerName: t('users.phone'), width: 130, sortable: false, valueGetter: (_v, row) => row.phone ?? '—' },
  ];
  if (canManage) columns.push({
    field: 'actions', headerName: t('common.actions'), width: 80, sortable: false, align: 'center',
    renderCell: ({ row, tabIndex }) => <Tooltip title={t('users.edit')}><IconButton size="small" color="primary" tabIndex={tabIndex}
      aria-label={`${t('users.edit')} ${row.employeeCode}`} onClick={() => open(`/users/${row.id}?mode=edit`)}><Edit fontSize="small" /></IconButton></Tooltip>,
  });
  const select = (key: string, label: string, options: [string, string][], width = 140) =>
    <TextField select size="small" label={label} value={value(key) || 'all'} sx={{ width: { xs: '100%', sm: width } }}
      slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 360 } } } } } }}
      onChange={e => set({ [key]: e.target.value === 'all' ? '' : e.target.value, page: '' })}>
      <MenuItem value="all">{t('common.all')}</MenuItem>
      {options.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
    </TextField>;
  return (
    <ListPageLayout fill title={t('nav.users')} error={list.error}
      actions={canManage && <ActionButton action="add" onClick={() => open('/users/new')}>{t('users.create')}</ActionButton>}
      toolbar={<FilterToolbar refreshing={list.isFetching}
        onRefresh={() => { set(Object.fromEntries([...FILTERS, 'sort', 'direction', 'page'].map(k => [k, '']))); void list.refetch(); }}>
        <SearchInput label={t('common.search')} placeholder={t('users.searchHint')} value={value('q')} onChange={v => set({ q: v, page: '' })}
          sx={{ flex: { xs: '1 1 100%', sm: '0 1 250px' }, minWidth: 0 }} />
        {select('orgUnitId', t('users.orgUnit'), (tree.data ?? []).map(n => [String(n.id), refLabel(n)]), 160)}
        <ServerAutocomplete<Ref> path="/admin/roles" sort="code" label={t('users.role')} getLabel={refLabel} placeholder={t('common.all')}
          value={roleId && role.data ? role.data : null} onChange={r => set({ roleId: r ? String(r.id) : '', page: '' })}
          sx={{ width: { xs: '100%', sm: 160 } }} />
        {select('employmentStatus', t('users.employmentStatus'), [['ACTIVE', t('users.employment.ACTIVE')], ['INACTIVE', t('users.employment.INACTIVE')]])}
        {select('accountStatus', t('users.accountStatus'), (['ACTIVE', 'INACTIVE', 'LOCKED', 'NONE'] as const).map(s => [s, t(`users.account.${s}`)]))}
      </FilterToolbar>}>
      <DataTable fill rows={list.data?.items ?? []} rowCount={list.data?.total ?? 0} columns={columns} loading={list.isFetching} error={list.error}
        paginationMode="server" sortingMode="server" emptyHint={t('users.empty')} sortModel={sortModel}
        onSortModelChange={model => set({ sort: model[0]?.field ?? '', direction: model[0]?.sort ?? '', page: '' })}
        paginationModel={paginationModel}
        onPaginationModelChange={model => set({ page: model.page ? String(model.page) : '', size: model.pageSize !== 25 ? String(model.pageSize) : '' })} />
    </ListPageLayout>
  );
}
