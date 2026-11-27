import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, FormControlLabel, IconButton, Stack, Switch, TextField,
  Tooltip, Typography,
} from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import PersonRemove from '@mui/icons-material/PersonRemoveOutlined';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { api, ApiError } from '../../services/api-client';
import { ActionResultDialog, ActiveChip, DataTable, DetailPageLayout, DetailTabs, FilterToolbar, FormDialog } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { ActionButton } from '../../shared/components/ActionButton';
import { ActivityHistoryTable } from '../../shared/components/ActivityHistoryTable';
import { DocumentRecordList } from '../../shared/components/DocumentRecordList';
import { RouteDiscardGuard } from '../../shared/components/FormDialog';
import { pickerSelectionColumn } from '../../shared/components/PickerSelection';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { SearchInput } from '../../shared/components/SearchInput';
import { useDebouncedText, useServerList } from '../../shared/utils/server-list';
import { useMe } from '../identity';
import { CatalogPermission, roleKey, RoleUser, usePermissionCatalog, useRole } from './api';

interface Draft { code: string; name: string; description: string; permissions: string[]; users: RoleUser[] }
type Field = 'code' | 'name';
const CODE = /^[A-Z][A-Z0-9_]{1,49}$/;
const sameSet = (a: (string | number)[], b: (string | number)[]) => a.length === b.length && a.every(x => b.includes(x));

/**
 * Create / View / Edit of one role (BA-UI-05) on the Common Full Page Detail (COMMON-DETAIL-PAGE-001): header with back,
 * title, code and status; tabs; the active panel scrolls; every action sits in the fixed footer. One Save sends info,
 * permissions and users together.
 */
export function RoleDetailPage({ id, copyId, startEditing, backTo }: { id: number; copyId?: number; startEditing: boolean; backTo: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe().data;
  const router = useContext(UNSAFE_DataRouterContext);
  const locationState: unknown = useLocation().state;
  const canManage = Boolean(me?.permissions.includes('ROLE.MANAGE'));
  const creating = id === 0;
  const role = useRole(creating ? copyId ?? 0 : id, !creating || Boolean(copyId));
  const catalog = usePermissionCatalog();
  const loaded = role.data;
  const initial = useMemo<Draft | undefined>(() => {
    if (creating && !copyId) return { code: '', name: '', description: '', permissions: [], users: [] };
    if (!loaded) return undefined;
    // A copy takes name, description and permissions only (no code, users, workflow configuration or history).
    if (creating) return { code: '', name: loaded.name, description: loaded.description ?? '', permissions: loaded.permissions, users: [] };
    return { code: loaded.code, name: loaded.name, description: loaded.description ?? '', permissions: loaded.permissions, users: loaded.users };
  }, [creating, copyId, loaded]);
  const [draft, setDraft] = useState<Draft>();
  // Requested by the URL or the Edit button; effective only once ROLE.MANAGE is confirmed for the signed-in user.
  const [editRequested, setEditing] = useState(creating || startEditing);
  const editing = editRequested && canManage;
  const [tab, setTab] = useState('general');
  // FE-VALIDATION-001: errors show once a field was left or Save was pressed, never on opening Create.
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  // A role just created arrives with its result in the route state (shown once on the new page).
  const [result, setResult] = useState<ActionResult | undefined>(() => (locationState as { roleResult?: ActionResult } | null)?.roleResult);
  const [created, setCreated] = useState<{ id: number; result: ActionResult }>();
  const fieldRefs = { code: useRef<HTMLInputElement>(null), name: useRef<HTMLInputElement>(null) };
  // Open the new role only after the cleared draft has rendered, so the unsaved-changes guard does not hold the navigation.
  useEffect(() => {
    if (created && !editing) navigate(`/roles/${created.id}`, { replace: true, state: { listSearch: backTo.replace(/^\/roles/, ''), roleResult: created.result } });
  }, [created, editing, navigate, backTo]);
  const value = draft ?? initial;
  const system = Boolean(loaded?.isSystem) && !creating;
  const dirty = Boolean(draft && initial && (draft.name !== initial.name || draft.description !== initial.description || draft.code !== initial.code
    || !sameSet(draft.permissions, initial.permissions) || !sameSet(draft.users.map(u => u.id), initial.users.map(u => u.id))));
  const rules: Partial<Record<Field, string>> = value ? {
    ...(creating && !value.code.trim() ? { code: t('roles.codeRequired') } : creating && !CODE.test(value.code) ? { code: t('roles.codeRule') } : {}),
    ...(!value.name.trim() ? { name: t('roles.nameRequired') } : {}),
  } : {};
  const errorOf = (field: Field) => (submitted || touched[field] ? rules[field] : undefined) ?? serverErrors[field];
  const update = (changes: Partial<Draft>) => {
    setDraft(previous => ({ ...(previous ?? initial!), ...changes }));
    setServerErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !(key in changes))));
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: value!.name.trim(), description: value!.description.trim() || null, permissions: value!.permissions, userIds: value!.users.map(u => u.id) };
      if (creating) return api<{ id: number }>('/admin/roles', { method: 'POST', body: JSON.stringify({ ...body, code: value!.code, ...(copyId ? { copiedFrom: copyId } : {}) }) });
      await api(`/admin/roles/${id}`, { method: 'PUT', body: JSON.stringify({ ...body, version: loaded!.version }) });
      return { id };
    },
    onSuccess: async ({ id: saved }) => {
      setConfirmSave(false);
      await qc.invalidateQueries({ queryKey: ['/admin/roles'] });
      await qc.invalidateQueries({ queryKey: roleKey(saved) });
      // My own effective permissions may come from this role: refresh identity (menu, routes, buttons).
      await qc.invalidateQueries({ queryKey: ['me'] });
      setDraft(undefined);
      setEditing(false);
      setSubmitted(false);
      setTouched({});
      const done: ActionResult = { success: true, title: t(creating ? 'roles.created' : 'roles.saved'), message: `${value!.code} · ${value!.name.trim()}` };
      if (creating) setCreated({ id: saved, result: done }); else setResult(done);
    },
    // The draft stays as typed; a field-level reason goes next to the field, the rest to the result dialog.
    onError: error => {
      setConfirmSave(false);
      if (error instanceof ApiError && error.code === 'DUPLICATE_VALUE' && creating) {
        setServerErrors({ code: t('roles.codeTaken') });
        setTab('general');
        queueMicrotask(() => fieldRefs.code.current?.focus());
      }
      setResult({ success: false, error, title: t('roles.saveFailed'), hint: conflictHint(error) });
    },
  });
  const status = useMutation({
    mutationFn: () => api(`/admin/roles/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !loaded!.isActive, version: loaded!.version }) }),
    onSuccess: async () => {
      setConfirmStatus(false);
      await qc.invalidateQueries({ queryKey: roleKey(id) });
      await qc.invalidateQueries({ queryKey: ['/admin/roles'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setResult({ success: true, title: t(loaded!.isActive ? 'roles.deactivated' : 'roles.activated'), message: `${loaded!.code} · ${loaded!.name}`,
        status: t(loaded!.isActive ? 'common.inactive' : 'common.active') });
    },
    onError: error => { setConfirmStatus(false); setResult({ success: false, error, title: t('roles.statusFailed'), hint: conflictHint(error) }); },
  });
  function conflictHint(error: unknown) {
    return error instanceof ApiError && error.code === 'VERSION_CONFLICT' ? t('roles.conflictHint') : undefined;
  }

  const title = creating ? t(copyId ? 'roles.copyTitle' : 'roles.createTitle') : t('roles.detailTitle');
  if (!value || catalog.isPending) {
    return <DetailPageLayout title={title} loading error={role.error ?? catalog.error} backTo={backTo} />;
  }
  const requestSave = () => {
    const first = (['code', 'name'] as Field[]).find(field => rules[field]);
    if (first) {
      setSubmitted(true);
      setTab('general');
      queueMicrotask(() => fieldRefs[first].current?.focus());
      return;
    }
    if (!creating && dirty && (!sameSet(value.permissions, initial!.permissions) || !sameSet(value.users.map(u => u.id), initial!.users.map(u => u.id)))) {
      setConfirmSave(true);
    } else save.mutate();
  };
  const cancelEdit = () => {
    if (creating) { navigate(backTo); return; }
    setDraft(undefined);
    setEditing(false);
    setSubmitted(false);
    setTouched({});
    setServerErrors({});
  };
  const footer = editing
    ? <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <ActionButton action="cancel" onClick={cancelEdit} disabled={save.isPending}>{t('common.cancel')}</ActionButton>
        <ActionButton action="save" onClick={requestSave} disabled={save.isPending}>{t('roles.save')}</ActionButton>
      </Stack>
    : canManage && loaded && <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {!system && (loaded.isActive
          ? <ActionButton action="void" onClick={() => setConfirmStatus(true)}>{t('roles.deactivate')}</ActionButton>
          : <ActionButton action="confirm" variant="outlined" onClick={() => setConfirmStatus(true)}>{t('roles.activate')}</ActionButton>)}
        <ActionButton action="edit" onClick={() => setEditing(true)}>{t('roles.edit')}</ActionButton>
      </Stack>;
  const affected = loaded?.users.length ?? 0;
  const added = initial ? value.permissions.filter(p => !initial.permissions.includes(p)).length : 0;
  const removed = initial ? initial.permissions.filter(p => !value.permissions.includes(p)).length : 0;
  const usersChanged = initial ? !sameSet(value.users.map(u => u.id), initial.users.map(u => u.id)) : false;

  return (
    <>
      <DetailPageLayout title={title} documentNumber={creating ? undefined : loaded?.code} backTo={backTo}
        status={!creating && loaded && <ActiveChip active={loaded.isActive} />}
        subtitle={system ? t('roles.systemHint') : undefined} footer={footer || undefined}>
        <DetailTabs value={tab} onChange={setTab} tabs={[
          { key: 'general', label: t('roles.tabGeneral'), invalid: Boolean(errorOf('code') || errorOf('name')), content:
            <GeneralTab value={value} editing={editing} creating={creating} isActive={loaded && !creating ? loaded.isActive : true}
              errorOf={errorOf} refs={fieldRefs} onTouch={field => setTouched(previous => ({ ...previous, [field]: true }))} onChange={update} /> },
          { key: 'permissions', label: t('roles.tabPermissions'), content:
            <PermissionsTab catalog={catalog.data ?? []} selected={value.permissions} readOnly={!editing || system} system={system}
              onChange={permissions => update({ permissions })} /> },
          { key: 'users', label: t('roles.tabUsers'), content:
            <UsersTab users={value.users} editing={editing} selfId={me?.id} onChange={users => update({ users })} /> },
          { key: 'history', label: t('roles.tabHistory'), hidden: creating, content: loaded &&
            <DocumentRecordList key={`${id}-${loaded.version}`} path={`/admin/roles/${id}/history`} items={loaded.history}
              nextCursor={loaded.historyCursor} render={items => <ActivityHistoryTable entries={items}
                actionLabel={action => t(`roles.history.${action}`, { defaultValue: action })}
                fieldLabel={field => t(`roles.${field}`, { defaultValue: field })}
                listLabel={(key, action) => t(`roles.historyList.${key}.${action.endsWith('REMOVED') ? 'removed' : action.endsWith('ADDED') ? 'added' : 'set'}`)} />} /> },
        ]} />
      </DetailPageLayout>
      {editing && router && <RouteDiscardGuard dirty={dirty} pending={save.isPending} />}
      {confirmSave && <FormDialog title={t('roles.confirmSaveTitle', { code: value.code })} submitLabel={t('roles.save')} submitAction="save"
        pending={save.isPending} canSubmit error={null} onClose={() => setConfirmSave(false)} onSubmit={() => save.mutate()}>
        <Stack spacing={1}>
          {(added > 0 || removed > 0) && <Typography>{t('roles.confirmPermissions', { added, removed })}</Typography>}
          {usersChanged && <Typography>{t('roles.confirmUsers', { count: value.users.length })}</Typography>}
          <Typography color="text.secondary">{t('roles.confirmAffected', { count: affected })}</Typography>
        </Stack>
      </FormDialog>}
      {confirmStatus && loaded && <FormDialog title={t(loaded.isActive ? 'roles.deactivateTitle' : 'roles.activateTitle')}
        description={`${loaded.code} · ${loaded.name}`} submitLabel={t(loaded.isActive ? 'roles.deactivate' : 'roles.activate')}
        submitAction={loaded.isActive ? 'void' : 'confirm'} pending={status.isPending} canSubmit error={null}
        onClose={() => setConfirmStatus(false)} onSubmit={() => status.mutate()}>
        {t(loaded.isActive ? 'roles.deactivateHint' : 'roles.activateHint', { count: affected })}
      </FormDialog>}
      {result && <ActionResultDialog result={result} onClose={() => setResult(undefined)} />}
    </>
  );
}

function GeneralTab({ value, editing, creating, isActive, errorOf, refs, onTouch, onChange }: {
  value: Draft; editing: boolean; creating: boolean; isActive: boolean; errorOf: (field: Field) => string | undefined;
  refs: Record<Field, React.RefObject<HTMLInputElement | null>>; onTouch: (field: Field) => void; onChange: (changes: Partial<Draft>) => void;
}) {
  const { t } = useTranslation();
  const codeError = errorOf('code');
  const nameError = errorOf('name');
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' }, gap: 2, maxWidth: 1080, pt: 0.5 }}>
      {creating
        ? <TextField label={t('roles.code')} value={value.code} required error={Boolean(codeError)} inputRef={refs.code}
            helperText={codeError ?? t('roles.codeHint')} onBlur={() => onTouch('code')}
            onChange={e => onChange({ code: e.target.value.toUpperCase() })} slotProps={{ htmlInput: { maxLength: 50 } }} />
        : <ReadOnlyField label={t('roles.code')} value={value.code} helperText={editing ? t('roles.codeLocked') : undefined} />}
      {editing
        ? <TextField label={t('roles.name')} value={value.name} required error={Boolean(nameError)} helperText={nameError} inputRef={refs.name}
            onBlur={() => onTouch('name')} onChange={e => onChange({ name: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
        : <ReadOnlyField label={t('roles.name')} value={value.name} />}
      <Box sx={{ gridColumn: '1 / -1' }}>
        {editing
          ? <TextField label={t('roles.description')} value={value.description} multiline minRows={2} fullWidth
              onChange={e => onChange({ description: e.target.value })} slotProps={{ htmlInput: { maxLength: 1000 } }} />
          : <ReadOnlyField label={t('roles.description')} value={value.description} multiline minRows={2} />}
      </Box>
      <Stack spacing={0.5} sx={{ gridColumn: '1 / -1' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('common.status')}</Typography>
        <Box><ActiveChip active={isActive} /></Box>
      </Stack>
    </Box>
  );
}

function PermissionsTab({ catalog, selected, readOnly, system, onChange }: {
  catalog: CatalogPermission[]; selected: string[]; readOnly: boolean; system: boolean; onChange: (codes: string[]) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const modules = [...new Set(catalog.map(p => p.module))];
  const [open, setOpen] = useState<string[]>(modules);
  const needle = q.trim().toLowerCase();
  const visible = (p: CatalogPermission) => (!needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle))
    && (!onlySelected || selected.includes(p.code));
  const toggle = (code: string, checked: boolean) => onChange(checked ? [...selected, code] : selected.filter(c => c !== code));
  return (
    <Stack spacing={1.5}>
      {system && <Alert severity="info">{t('roles.systemPermissions')}</Alert>}
      <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
        <SearchInput label={t('common.search')} placeholder={t('roles.permissionSearch')} value={q} onChange={setQ} sx={{ flex: '0 1 380px', minWidth: 220 }} />
        <FormControlLabel control={<Switch checked={onlySelected} onChange={e => setOnlySelected(e.target.checked)} />} label={t('roles.onlySelected')} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('roles.totalSelected', { count: selected.length, total: catalog.length })}</Typography>
        <Button size="small" onClick={() => setOpen(modules)}>{t('roles.expandAll')}</Button>
        <Button size="small" onClick={() => setOpen([])}>{t('roles.collapseAll')}</Button>
      </Stack>
      {modules.map(module => {
        const all = catalog.filter(p => p.module === module);
        const shown = all.filter(visible);
        if (!shown.length) return null;
        const count = all.filter(p => selected.includes(p.code)).length;
        const expanded = open.includes(module) || Boolean(needle);
        return (
          <Accordion key={module} disableGutters variant="outlined" expanded={expanded}
            onChange={(_e, isOpen) => setOpen(previous => isOpen ? [...previous, module] : previous.filter(m => m !== module))}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography sx={{ fontWeight: 600 }}>{t(`roles.modules.${module}`, { defaultValue: module })}</Typography>
              <Typography color="text.secondary" sx={{ ml: 1 }}>{t('roles.selectedCount', { count, total: all.length })}</Typography>
            </AccordionSummary>
            {/* One permission per row; OA3 adds the scope selector on the right of each row. */}
            <AccordionDetails sx={{ p: 0 }}>
              {shown.map(p => {
                const locked = p.adminOnly && !system;
                const checked = selected.includes(p.code);
                const control = <Checkbox checked={checked} disabled={readOnly || locked} onChange={e => toggle(p.code, e.target.checked)}
                  slotProps={{ input: { 'aria-label': `${p.name} (${p.code})` } }}
                  // Read-only stays legible: the checked state keeps the primary color (not the disabled grey).
                  sx={readOnly && !locked ? { '&.Mui-disabled': { color: checked ? 'primary.main' : 'action.active' } } : undefined} />;
                return (
                  <Stack key={p.code} direction="row" data-permission-row sx={{ alignItems: 'center', px: 1, py: 0.25, borderTop: 1, borderColor: 'divider' }}>
                    {locked ? <Tooltip title={t('roles.adminOnlyHint')}><span>{control}</span></Tooltip> : control}
                    <Box sx={{ minWidth: 0, flex: 1, py: 0.5 }}>
                      <Typography variant="body2">{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{p.code}</Typography>
                      {locked && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('roles.adminOnly')}</Typography>}
                    </Box>
                  </Stack>
                );
              })}
            </AccordionDetails>
          </Accordion>
        );
      })}
      {!catalog.some(visible) && <Typography color="text.secondary">{t('roles.noPermissionMatch')}</Typography>}
    </Stack>
  );
}

function UsersTab({ users, editing, selfId, onChange }: { users: RoleUser[]; editing: boolean; selfId?: number; onChange: (users: RoleUser[]) => void }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const columns: GridColDef<RoleUser>[] = [
    { field: 'username', headerName: t('login.username'), minWidth: 160, flex: 1 },
    { field: 'fullName', headerName: t('account.fullName'), minWidth: 200, flex: 1.5 },
    { field: 'isActive', headerName: t('roles.accountStatus'), width: 150, renderCell: ({ row }) => <ActiveChip active={row.isActive} /> },
  ];
  if (editing) columns.push({ field: 'actions', headerName: t('common.actions'), width: 96, sortable: false, align: 'center',
    renderCell: ({ row, tabIndex }) => row.id === selfId
      ? <Tooltip title={t('roles.selfHint')}><span><IconButton size="small" disabled tabIndex={tabIndex}><PersonRemove fontSize="small" /></IconButton></span></Tooltip>
      : <Tooltip title={t('roles.removeUser')}><IconButton size="small" color="error" tabIndex={tabIndex} aria-label={`${t('roles.removeUser')} ${row.username}`}
          onClick={() => onChange(users.filter(u => u.id !== row.id))}><PersonRemove fontSize="small" /></IconButton></Tooltip> });
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{t('roles.usersHint')}</Typography>
        {editing && <ActionButton action="add" variant="outlined" onClick={() => setPicking(true)}>{t('roles.addUsers')}</ActionButton>}
      </Stack>
      <DataTable rows={users} columns={columns} emptyHint={t('roles.noUsers')} />
      {picking && <UserPicker assigned={users.map(u => u.id)} selfId={selfId} onClose={() => setPicking(false)}
        onConfirm={picked => { onChange([...users, ...picked]); setPicking(false); }} />}
    </Stack>
  );
}

/**
 * Common Picker pattern (COMMON-LIST-002, like Product Picker): server-side search, sort and pages; selection kept across
 * pages and searches; assigned users locked; Cancel changes nothing. The role keeps the picked users only on Save.
 */
function UserPicker({ assigned, selfId, onClose, onConfirm }: { assigned: number[]; selfId?: number; onClose: () => void; onConfirm: (users: RoleUser[]) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const debounced = useDebouncedText(q);
  const [page, setPage] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [sort, setSort] = useState<{ field: string; sort: 'asc' | 'desc' }>({ field: 'username', sort: 'asc' });
  const [picked, setPicked] = useState(new Map<number, RoleUser>());
  // Stable reference: a new sortModel object each render reads as a sort change and sends the grid back to page 1.
  const sortModel = useMemo(() => [sort], [sort]);
  const params = new URLSearchParams({ sort: sort.field, direction: sort.sort, page: String(page.page), size: String(page.pageSize) });
  if (debounced.trim()) params.set('q', debounced.trim());
  const options = useServerList<RoleUser>('/admin/roles/user-options', params);
  // The signed-in admin cannot add themself (SELF_CHANGE_DENIED), so the row is not offered.
  const rows = (options.data?.items ?? []).filter(u => u.id !== selfId);
  const select = (changed: RoleUser[], checked: boolean) => setPicked(previous => {
    const next = new Map(previous);
    for (const user of changed) if (checked) next.set(user.id, user); else next.delete(user.id);
    return next;
  });
  return (
    <FormDialog title={t('roles.addUsers')} submitLabel={t('roles.addPicked')} submitAction="confirm" width={900}
      canSubmit={picked.size > 0} pending={false} error={options.error} pageGuardsNavigation
      footerAside={t('roles.pickedCount', { count: picked.size })} onClose={onClose} onSubmit={() => onConfirm([...picked.values()])}>
      <FilterToolbar refreshing={options.isFetching} onRefresh={() => {
        setQ(''); setSort({ field: 'username', sort: 'asc' }); setPage(previous => ({ ...previous, page: 0 })); void options.refetch();
      }}>
        <SearchInput label={t('common.search')} placeholder={t('roles.userSearch')} value={q}
          onChange={value => { setQ(value); setPage(previous => ({ ...previous, page: 0 })); }} sx={{ flex: '1 1 260px' }} />
      </FilterToolbar>
      <DataTable rows={rows} rowCount={options.data?.total ?? 0} loading={options.isFetching} error={options.error}
        paginationMode="server" sortingMode="server" paginationModel={page} onPaginationModelChange={setPage}
        sortModel={sortModel} onSortModelChange={model => { if (model[0]?.sort) setSort({ field: model[0].field, sort: model[0].sort }); setPage(previous => ({ ...previous, page: 0 })); }}
        maxHeight="min(48dvh, 460px)" emptyHint={t('roles.noUserMatch')}
        getRowClassName={({ id }) => picked.has(Number(id)) ? 'common-grid-selected' : ''}
        columns={[
          pickerSelectionColumn<RoleUser>(row => picked.has(row.id), select, row => row.username, false, row => assigned.includes(row.id)),
          { field: 'username', headerName: t('login.username'), minWidth: 160, flex: 1 },
          { field: 'fullName', headerName: t('account.fullName'), minWidth: 200, flex: 1.5 },
          { field: 'isActive', headerName: t('roles.accountStatus'), width: 150, renderCell: ({ row }) => <ActiveChip active={row.isActive} /> },
          { field: 'assigned', headerName: '', width: 110, sortable: false, renderCell: ({ row }) => assigned.includes(row.id)
            ? <Typography variant="caption" color="text.secondary">{t('roles.alreadyAssigned')}</Typography> : null },
        ]} />
    </FormDialog>
  );
}
