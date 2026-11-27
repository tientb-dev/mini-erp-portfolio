import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Alert, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import Edit from '@mui/icons-material/EditOutlined';
import Remove from '@mui/icons-material/RemoveCircleOutlineOutlined';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ActiveChip, DataTable, FilterToolbar, FormDialog, GridText } from '../../shared/components';
import { ActionButton } from '../../shared/components/ActionButton';
import { pickerSelectionColumn } from '../../shared/components/PickerSelection';
import { SearchInput } from '../../shared/components/SearchInput';
import { fmtDay } from '../../shared/utils/format';
import { useDebouncedText, useServerList } from '../../shared/utils/server-list';
import { useMe } from '../identity';
import { MembershipDialog, MembershipValue } from './MembershipDialog';
import { CheckMark } from './UserChips';
import { Membership, PersonRef, personLabel, Ref, refLabel } from './users-api';

const iconAction = (label: string, onClick: () => void, icon: React.ReactNode, blocked?: string, color: 'primary' | 'error' = 'primary') =>
  <Tooltip key={label} title={blocked ?? label}><span>
    <IconButton size="small" color={color} disabled={Boolean(blocked)} aria-label={label} onClick={onClick}>{icon}</IconButton>
  </span></Tooltip>;

/** Apply one membership to the draft: one row per unit; marking a primary moves the primary there (BA-ORG-04). */
export function applyMembership(list: Membership[], value: MembershipValue, replacing?: number): Membership[] {
  const kept = list.filter(m => m.orgUnit.id !== (replacing ?? value.orgUnit.id)).map(m => (value.isPrimary ? { ...m, isPrimary: false } : m));
  const old = list.find(m => m.orgUnit.id === (replacing ?? value.orgUnit.id));
  return [...kept, { ...old, orgUnit: value.orgUnit, jobTitle: value.jobTitle, manager: value.manager, isPrimary: value.isPrimary }];
}

/** Tổ chức: ACTIVE memberships of the draft; changes apply on Save. Ended memberships stay in history (BA-ORG-13). */
export function OrgTab({ employee, memberships, readOnly, self, onChange }: {
  employee: PersonRef; memberships: Membership[]; readOnly: boolean; self: boolean; onChange: (list: Membership[]) => void;
}) {
  const { t } = useTranslation();
  const canViewOrg = Boolean(useMe().data?.permissions.includes('ORGANIZATION.VIEW'));
  const [dialog, setDialog] = useState<{ edit?: Membership }>();
  const columns: GridColDef<Membership>[] = [
    // A unit opens its node in Cơ cấu tổ chức (route + permission checked; the page's dirty guard asks before leaving).
    { field: 'orgUnit', headerName: t('users.orgUnit'), minWidth: 220, flex: 1.2, valueGetter: (_v, row) => refLabel(row.orgUnit),
      renderCell: ({ row, tabIndex }) => <GridText value={refLabel(row.orgUnit)} tabIndex={tabIndex} to={canViewOrg ? `/org-units/${row.orgUnit.id}` : undefined} /> },
    { field: 'jobTitle', headerName: t('users.jobTitle'), minWidth: 150, flex: 1, valueGetter: (_v, row) => row.jobTitle.name },
    { field: 'isPrimary', headerName: t('users.primaryUnit'), width: 120, align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => row.isPrimary && <CheckMark label={t('users.primaryUnit')} /> },
    { field: 'isHead', headerName: t('orgUnits.head'), width: 130, align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => row.isHead && <CheckMark label={t('orgUnits.head')} /> },
    { field: 'manager', headerName: t('users.manager'), minWidth: 180, flex: 1, valueGetter: (_v, row) => (row.manager ? personLabel(row.manager) : '—') },
    { field: 'startedAt', headerName: t('users.startedAt'), width: 110, valueGetter: (_v, row) => (row.startedAt ? fmtDay(row.startedAt) : t('users.notSaved')) },
  ];
  if (!readOnly) columns.push({ field: 'actions', headerName: t('common.actions'), width: 96, sortable: false, align: 'center',
    renderCell: ({ row }) => <Stack direction="row" sx={{ alignItems: 'center', height: '100%' }}>
      {iconAction(`${t('users.editMembership')} ${row.orgUnit.code}`, () => setDialog({ edit: row }), <Edit fontSize="small" />)}
      {iconAction(`${t('users.endMembership')} ${row.orgUnit.code}`, () => onChange(memberships.filter(m => m !== row)), <Remove fontSize="small" />,
        // BA-N-05: the head's membership cannot end; BA-ORG-04: move the primary before ending it.
        row.isHead ? t('users.endBlockedHead') : row.isPrimary && memberships.length > 1 ? t('users.endBlockedPrimary') : undefined, 'error')}
    </Stack> });
  return (
    <Stack spacing={1.5}>
      {self && <Alert severity="info">{t('users.selfRelationsHint')}</Alert>}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{t('users.orgHint')}</Typography>
        {!readOnly && <ActionButton action="add" variant="outlined" onClick={() => setDialog({})}>{t('users.addMembership')}</ActionButton>}
      </Stack>
      <DataTable rows={memberships} getRowId={row => row.orgUnit.id} columns={columns} emptyHint={t('users.noMemberships')} />
      {dialog && <MembershipDialog employee={employee} initial={dialog.edit} forcePrimary={!memberships.length}
        currentPrimary={memberships.find(m => m.isPrimary)?.orgUnit ?? null}
        takenUnitIds={memberships.map(m => m.orgUnit.id)} pending={false} error={null} onClose={() => setDialog(undefined)}
        onSubmit={value => { onChange(applyMembership(memberships, value, dialog.edit?.orgUnit.id)); setDialog(undefined); }} />}
    </Stack>
  );
}

type Option = Ref & { isActive: boolean };

/** Vai trò / Phạm vi dữ liệu (Warehouse Grant): the draft's list with a Common Picker; saved with the User. */
export function RefListTab({ kind, items, readOnly, self, blockedReason, onChange }: {
  kind: 'roles' | 'warehouses'; items: Option[] | Ref[]; readOnly: boolean; self: boolean; blockedReason?: string; onChange: (items: Ref[]) => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  // Warehouses: the whole catalog (no paging on that API) gives each granted warehouse its status. Roles carry their own.
  const warehouses = useQuery({ queryKey: ['/warehouses', 'grant-options'], enabled: kind === 'warehouses', staleTime: 30_000, queryFn: () => api<Option[]>('/warehouses') });
  const active = (row: Ref) => ('isActive' in row ? (row as Option).isActive : warehouses.data?.find(o => o.id === row.id)?.isActive ?? true);
  const columns: GridColDef<Ref>[] = [
    { field: 'code', headerName: t(`users.${kind}Code`), minWidth: 150, flex: 0.8 },
    { field: 'name', headerName: t(`users.${kind}Name`), minWidth: 200, flex: 1.5 },
    { field: 'status', headerName: t('common.status'), width: 140, sortable: false, renderCell: ({ row }) => <ActiveChip active={active(row)} /> },
  ];
  if (!readOnly) columns.push({ field: 'actions', headerName: t('common.actions'), width: 96, sortable: false, align: 'center',
    renderCell: ({ row }) => iconAction(`${t(`users.remove_${kind}`)} ${row.code}`, () => onChange(items.filter(i => i.id !== row.id)), <Remove fontSize="small" />, undefined, 'error') });
  return (
    <Stack spacing={1.5}>
      {self && <Alert severity="info">{t('users.selfRelationsHint')}</Alert>}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{t(`users.${kind}Hint`)}</Typography>
        {!readOnly && <Tooltip title={blockedReason ?? ''}><span>
          <ActionButton action="add" variant="outlined" disabled={Boolean(blockedReason)} onClick={() => setPicking(true)}>{t(`users.add_${kind}`)}</ActionButton>
        </span></Tooltip>}
      </Stack>
      {!readOnly && blockedReason && <Typography variant="caption" color="text.secondary">{blockedReason}</Typography>}
      <DataTable rows={items} columns={columns} emptyHint={t(`users.no_${kind}`)} />
      {picking && <RefPicker kind={kind} assigned={items.map(i => i.id)}
        // Only active warehouses can be newly granted (WAREHOUSE_INACTIVE); granted ones stay listed and locked.
        warehouses={(warehouses.data ?? []).filter(o => o.isActive || items.some(i => i.id === o.id))} warehousesState={warehouses}
        onClose={() => setPicking(false)} onConfirm={picked => { onChange([...items, ...picked]); setPicking(false); }} />}
    </Stack>
  );
}

/**
 * COMMON-PICKER-001: roles page and search on the server (no cap); warehouses from their full list. Selection kept across
 * search, pages and refresh; assigned rows locked; Cancel changes nothing; the parent keeps the picks only on Save.
 */
function RefPicker({ kind, assigned, warehouses, warehousesState, onClose, onConfirm }: {
  kind: 'roles' | 'warehouses'; assigned: number[]; warehouses: Option[];
  warehousesState: { isFetching: boolean; error: unknown; refetch: () => unknown }; onClose: () => void; onConfirm: (items: Option[]) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const debounced = useDebouncedText(q);
  const [page, setPage] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [picked, setPicked] = useState(new Map<number, Option>());
  const params = new URLSearchParams({ sort: 'code', direction: 'asc', page: String(page.page), size: String(page.pageSize) });
  if (debounced.trim()) params.set('q', debounced.trim());
  const roles = useServerList<Option>('/admin/roles', params, kind === 'roles');
  const needle = q.trim().toLowerCase();
  const localRows = useMemo(() => warehouses.filter(o => !needle || o.code.toLowerCase().includes(needle) || o.name.toLowerCase().includes(needle)), [warehouses, needle]);
  const server = kind === 'roles';
  const state = server ? roles : warehousesState;
  const select = (changed: Option[], checked: boolean) => setPicked(previous => {
    const next = new Map(previous);
    for (const o of changed) if (checked) next.set(o.id, { id: o.id, code: o.code, name: o.name, isActive: o.isActive }); else next.delete(o.id);
    return next;
  });
  return (
    <FormDialog title={t(`users.add_${kind}`)} submitLabel={t('users.addPicked')} submitAction="confirm" width={820} pageGuardsNavigation
      canSubmit={picked.size > 0} pending={false} error={state.error} footerAside={t('users.pickedCount', { count: picked.size })} onClose={onClose}
      onSubmit={() => onConfirm([...picked.values()])}>
      <FilterToolbar refreshing={state.isFetching} onRefresh={() => { setQ(''); setPage(p => ({ ...p, page: 0 })); void state.refetch(); }}>
        <SearchInput label={t('common.search')} placeholder={t('searchFields.codeOrName')} value={q}
          onChange={value => { setQ(value); setPage(p => ({ ...p, page: 0 })); }} sx={{ flex: '1 1 260px' }} />
      </FilterToolbar>
      <DataTable rows={server ? roles.data?.items ?? [] : localRows} loading={state.isFetching} maxHeight="min(48dvh, 460px)" emptyHint={t('users.noOptionMatch')}
        {...(server && { paginationMode: 'server' as const, rowCount: roles.data?.total ?? 0, paginationModel: page, onPaginationModelChange: setPage })}
        getRowClassName={({ id }) => (picked.has(Number(id)) ? 'common-grid-selected' : '')}
        columns={[
          pickerSelectionColumn<Option>(row => picked.has(row.id), select, row => refLabel(row), false, row => assigned.includes(row.id)),
          { field: 'code', headerName: t(`users.${kind}Code`), minWidth: 140, flex: 0.8, sortable: !server },
          { field: 'name', headerName: t(`users.${kind}Name`), minWidth: 200, flex: 1.5, sortable: !server },
          { field: 'isActive', headerName: t('common.status'), width: 130, sortable: false, renderCell: ({ row }) => <ActiveChip active={row.isActive} /> },
          { field: 'assigned', headerName: '', width: 100, sortable: false, renderCell: ({ row }) => assigned.includes(row.id)
            ? <Typography variant="caption" color="text.secondary">{t('roles.alreadyAssigned')}</Typography> : null },
        ]} />
    </FormDialog>
  );
}
