import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconButton, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import Edit from '@mui/icons-material/EditOutlined';
import Copy from '@mui/icons-material/ContentCopyOutlined';
import type { GridColDef, GridSortDirection } from '@mui/x-data-grid';
import { api, ApiError } from '../../services/api-client';
import { ActionResultDialog, ActiveChip, DataTable, FilterToolbar, FormDialog, GridText, ListPageLayout } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { ActionButton } from '../../shared/components/ActionButton';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { SearchInput } from '../../shared/components/SearchInput';
import { useDebouncedText, useServerList } from '../../shared/utils/server-list';
import { useMe } from '../identity';

export interface JobTitle { id: number; code: string; name: string; description: string | null; isActive: boolean; version: number }

const PATH = '/admin/job-titles';
const SORTABLE = ['code', 'name', 'isActive'];
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/;

/**
 * Chức danh (OA2.1, BA-UI-03): server-side Master List + FormDialog. `/job-titles/:id` opens the dialog over the list
 * (`?mode=edit` to edit), `/job-titles/new?copy=<id>` copies; list state stays in the URL.
 */
export function JobTitlesPage({ initialId }: { initialId?: number }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const qc = useQueryClient();
  const canManage = Boolean(useMe().data?.permissions.includes('ORGANIZATION.MANAGE'));
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
  const list = useServerList<JobTitle>(PATH, apiParams);
  const [result, setResult] = useState<ActionResult>();
  const dismissResult = useCallback(() => setResult(undefined), []);
  const [confirmation, setConfirmation] = useState<JobTitle>();
  const target = (row: Pick<JobTitle, 'code' | 'name'>) => t('master.resultTarget', { name: row.name, code: row.code });
  const refresh = () => qc.invalidateQueries({ queryKey: [PATH] });
  const updateStatus = useMutation({
    mutationFn: ({ row, isActive }: { row: JobTitle; isActive: boolean }) =>
      api(`${PATH}/${row.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive, version: row.version }) }),
    onSettled: () => { setConfirmation(undefined); void refresh(); },
    onSuccess: (_r, { row, isActive }) => setResult({ success: true, message: target(row), status: t(isActive ? 'common.active' : 'common.inactive'),
      title: t('master.resultSuccess', { action: t(isActive ? 'master.activate' : 'master.disable') }) }),
    onError: (error, { row, isActive }) => setResult({ success: false, error, message: target(row),
      title: t('master.resultFailure', { action: t(isActive ? 'master.activate' : 'master.disable') }) }),
  });

  const set = (changes: Record<string, string>) => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const close = () => navigate('/job-titles' + listSearch, { replace: true });
  const columns: GridColDef<JobTitle>[] = [
    { field: 'code', headerName: t('jobTitles.code'), minWidth: 150, flex: 0.8,
      renderCell: ({ row, tabIndex }) => <GridText to={`/job-titles/${row.id}${listSearch}`} tabIndex={tabIndex} value={row.code} /> },
    { field: 'name', headerName: t('jobTitles.name'), minWidth: 200, flex: 1.3 },
    { field: 'description', headerName: t('master.fields.description'), minWidth: 200, flex: 1.5, sortable: false },
    { field: 'isActive', headerName: t('common.status'), minWidth: 198,
      renderCell: ({ row, tabIndex }) => canManage ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', height: '100%' }}>
          <Switch size="small" checked={row.isActive} disabled={updateStatus.isPending || Boolean(result)}
            slotProps={{ input: { role: 'switch', 'aria-label': `${t('common.status')} ${row.code}`, tabIndex } }}
            onChange={(_event, isActive) => isActive ? updateStatus.mutate({ row, isActive }) : setConfirmation(row)} />
          {t(row.isActive ? 'common.active' : 'common.inactive')}
        </Stack>
      ) : <ActiveChip active={row.isActive} /> },
  ];
  if (canManage) columns.push({
    field: 'actions', headerName: t('common.actions'), width: 96, sortable: false, align: 'center',
    renderCell: ({ row, tabIndex }) => <Stack direction="row" sx={{ alignItems: 'center', height: '100%' }}>
      <Tooltip title={t('master.editAction')}><IconButton size="small" color="primary" tabIndex={tabIndex} aria-label={`${t('master.editAction')} ${row.code}`}
        onClick={() => navigate(`/job-titles/${row.id}?${new URLSearchParams([...listParams, ['mode', 'edit']])}`)}><Edit fontSize="small" /></IconButton></Tooltip>
      <Tooltip title={t('master.duplicate')}><IconButton size="small" color="primary" tabIndex={tabIndex} aria-label={`${t('master.duplicate')} ${row.code}`}
        onClick={() => navigate(`/job-titles/new?${new URLSearchParams([...listParams, ['copy', String(row.id)]])}`)}><Copy fontSize="small" /></IconButton></Tooltip>
    </Stack>,
  });
  const copyId = Number(params.get('copy')) || undefined;
  return (
    <>
      <ListPageLayout title={t('nav.jobTitles')} error={list.error}
        actions={canManage && <ActionButton action="add" onClick={() => navigate('/job-titles/new' + listSearch)}>{t('jobTitles.create')}</ActionButton>}
        toolbar={<FilterToolbar refreshing={list.isFetching}
          onRefresh={() => { set({ q: '', status: '', sort: '', direction: '', page: '' }); void list.refetch(); }}>
          <SearchInput label={t('common.search')} placeholder={t('searchFields.codeOrName')} value={q} onChange={value => set({ q: value, page: '' })}
            sx={{ flex: { xs: '1 1 100%', sm: '0 1 420px' }, minWidth: 0 }} />
          <TextField select size="small" label={t('common.status')} value={status || 'all'} sx={{ width: { xs: '100%', sm: 180 } }}
            onChange={event => set({ status: event.target.value === 'all' ? '' : event.target.value, page: '' })}>
            <MenuItem value="all">{t('common.all')}</MenuItem>
            <MenuItem value="true">{t('common.active')}</MenuItem>
            <MenuItem value="false">{t('common.inactive')}</MenuItem>
          </TextField>
        </FilterToolbar>}>
        <DataTable rows={list.data?.items ?? []} rowCount={list.data?.total ?? 0} columns={columns} loading={list.isFetching} error={list.error}
          paginationMode="server" sortingMode="server" sortModel={sortModel}
          onSortModelChange={model => set({ sort: model[0]?.field ?? '', direction: model[0]?.sort ?? '', page: '' })}
          paginationModel={paginationModel}
          onPaginationModelChange={model => set({ page: model.page ? String(model.page) : '', size: model.pageSize !== 25 ? String(model.pageSize) : '' })} />
      </ListPageLayout>
      {initialId !== undefined && !result && <JobTitleDialog key={`${initialId}:${copyId ?? ''}:${params.get('mode') ?? ''}`} id={initialId || undefined}
        copyId={initialId === 0 ? copyId : undefined} canManage={canManage} startEditing={params.get('mode') === 'edit'} onClose={close}
        onSaved={saved => { void refresh(); setResult(saved); close(); }} onFailed={setResult} />}
      {confirmation && <FormDialog title={t('jobTitles.disableTitle')} description={`${confirmation.code} · ${confirmation.name}`}
        submitLabel={t('master.disable')} submitAction="void"
        pending={updateStatus.isPending} canSubmit error={null} onClose={() => setConfirmation(undefined)}
        onSubmit={() => updateStatus.mutate({ row: confirmation, isActive: false })}>
        {t('jobTitles.disableHint')}
      </FormDialog>}
      {result && <ActionResultDialog result={result} onClose={dismissResult} />}
    </>
  );
}

function JobTitleDialog({ id, copyId, canManage, startEditing, onClose, onSaved, onFailed }: {
  id?: number; copyId?: number; canManage: boolean; startEditing: boolean; onClose: () => void;
  onSaved: (result: ActionResult) => void; onFailed: (result: ActionResult) => void;
}) {
  const { t } = useTranslation();
  const sourceId = id ?? copyId;
  const source = useQuery({ queryKey: [PATH, 'detail', sourceId], queryFn: () => api<JobTitle>(`${PATH}/${sourceId}`), enabled: Boolean(sourceId) });
  // Permissions may load after the dialog opens from a URL; the edit intent waits for them instead of being dropped.
  const [wantsEdit, setEditing] = useState(!id || startEditing);
  const editing = wantsEdit && canManage;
  const [fields, setFields] = useState<{ code?: string; name?: string; description?: string }>({});
  const entry = id ? source.data : undefined;
  const initial = { code: entry?.code ?? '', name: source.data?.name ?? '', description: source.data?.description ?? '' };
  const value = { ...initial, ...fields };
  const dirty = editing && (['code', 'name', 'description'] as const).some(key => value[key] !== initial[key]);
  const action = t(id ? 'doc.saveEdit' : 'master.addAction');
  const save = useMutation({
    mutationFn: () => {
      const body = { name: value.name.trim(), description: value.description.trim() || null };
      return id
        ? api(`${PATH}/${id}`, { method: 'PUT', body: JSON.stringify({ ...body, version: entry!.version }) })
        : api(PATH, { method: 'POST', body: JSON.stringify({ ...body, code: value.code.trim(), ...(copyId && { copiedFrom: copyId }) }) });
    },
    onSuccess: () => onSaved({ success: true, title: t('master.resultSuccess', { action }), message: t('master.resultTarget', { name: value.name.trim(), code: value.code.trim() }) }),
    onError: error => {
      if (!(error instanceof ApiError && error.code === 'DUPLICATE_VALUE')) {
        onFailed({ success: false, error, title: t('master.resultFailure', { action }), message: t('master.resultTarget', { name: value.name.trim(), code: value.code.trim() }) });
      }
    },
  });
  const issues = {
    code: !value.code.trim() ? t('master.required') : !CODE.test(value.code.trim()) ? t('jobTitles.codeFormat')
      : save.error instanceof ApiError && save.error.code === 'DUPLICATE_VALUE' ? t('errors.DUPLICATE_VALUE') : undefined,
    name: !value.name.trim() ? t('master.required') : value.name.trim().length > 200 ? t('master.tooLong', { count: 200 }) : undefined,
    description: value.description.length > 1000 ? t('master.tooLong', { count: 1000 }) : undefined,
  };
  const ready = !issues.code && !issues.name && !issues.description;
  const missing = Boolean(sourceId) && source.isError;
  const title = t(editing ? id ? 'master.edit' : 'master.create' : 'master.view', { name: t('jobTitles.entity') });
  const field = (key: 'code' | 'name' | 'description', span: number, label: string) => {
    const locked = key === 'code' && Boolean(id);
    const shown = editing && !locked && (fields[key] !== undefined || key === 'code' && save.isError) ? issues[key] : undefined;
    return <DocumentFormCell span={span}>
      {!editing || locked ? <ReadOnlyField label={label} value={value[key]} multiline={key === 'description'} minRows={key === 'description' ? 2 : undefined} />
        : <TextField fullWidth size="small" label={label} value={value[key]} required={key !== 'description'} disabled={save.isPending}
          multiline={key === 'description'} minRows={key === 'description' ? 2 : undefined} error={Boolean(shown)} helperText={shown}
          onChange={event => { setFields({ ...fields, [key]: event.target.value }); save.reset(); }} />}
    </DocumentFormCell>;
  };
  const loading = Boolean(sourceId) && source.isPending;
  return (
    <FormDialog pageGuardsNavigation title={title} dirty={dirty} pending={save.isPending} error={missing ? source.error : null}
      submitLabel={editing ? action : canManage && !missing ? t('master.editAction') : undefined} submitAction={editing ? 'save' : 'edit'}
      closeLabel={!editing ? t('common.close') : undefined} canSubmit={!loading && !missing && (!editing || ready)}
      onSubmit={() => editing ? save.mutate() : setEditing(true)} onClose={onClose}>
      {!loading && !missing && <DocumentFormGrid>
        {field('code', 4, t('jobTitles.code'))}
        {field('name', 8, t('jobTitles.name'))}
        {field('description', 12, t('master.fields.description'))}
        <DocumentFormCell span={4}>
          <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="caption">{t('common.status')}</Typography>
            <ActiveChip active={entry?.isActive ?? true} />
          </Stack>
        </DocumentFormCell>
      </DocumentFormGrid>}
    </FormDialog>
  );
}
