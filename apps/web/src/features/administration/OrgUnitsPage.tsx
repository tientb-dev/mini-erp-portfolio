import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Collapse, IconButton, List, ListItemButton, ListItemText, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandAllIcon from '@mui/icons-material/KeyboardDoubleArrowDown';
import CollapseAllIcon from '@mui/icons-material/KeyboardDoubleArrowUp';
import { api, ApiError } from '../../services/api-client';
import { fillMedia } from '../../config/theme';
import { ActionResultDialog, ActiveChip, DetailTabs, FormDialog, ListPageLayout } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { ActionButton } from '../../shared/components/ActionButton';
import { ActivityHistoryTable, type ActivityEntry } from '../../shared/components/ActivityHistoryTable';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { DocumentRecordList } from '../../shared/components/DocumentRecordList';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { SearchInput } from '../../shared/components/SearchInput';
import { useMe } from '../identity';
import { OrgUnitMembers, useMembers } from './OrgUnitMembers';
import { PersonRef, personLabel } from './users-api';

export interface OrgNode { id: number; code: string; name: string; parentId: number | null; isActive: boolean; version: number; memberCount?: number }
interface UnitRef { id: number; code: string; name: string }
interface OrgUnit {
  id: number; code: string; name: string; description: string | null; isActive: boolean; version: number; parent: UnitRef | null; headUserId: number | null;
  head: PersonRef | null;
}

const PATH = '/admin/org-units';
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/;
const label = (u: Pick<UnitRef, 'code' | 'name'>) => `${u.code} · ${u.name}`;

/** Ids of `id` and every unit below it. */
function subtree(children: Map<number | null, OrgNode[]>, id: number) {
  const ids = new Set([id]);
  for (const current of ids) for (const child of children.get(current) ?? []) ids.add(child.id);
  return ids;
}

/**
 * Cơ cấu tổ chức (OA2.2, BA-UI-02): tree (~30%) + detail panel. No drag-and-drop; the parent changes through the form,
 * with a confirmation. `/org-units/:id` selects a unit.
 */
export function OrgUnitsPage({ initialId }: { initialId?: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManage = Boolean(useMe().data?.permissions.includes('ORGANIZATION.MANAGE'));
  const tree = useQuery({ queryKey: [PATH, 'tree'], queryFn: () => api<OrgNode[]>(`${PATH}/tree`) });
  const nodes = useMemo(() => tree.data ?? [], [tree.data]);
  const children = useMemo(() => {
    const map = new Map<number | null, OrgNode[]>();
    for (const n of nodes) map.set(n.parentId, [...(map.get(n.parentId) ?? []), n]);
    return map;
  }, [nodes]);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<{ parentId: number | null } | { edit: OrgUnit }>();
  const [result, setResult] = useState<ActionResult>();
  const term = q.trim().toLowerCase();
  // Search keeps each match's ancestor path so the result stays in context (BA-UI-02).
  const shown = useMemo(() => {
    if (!term) return undefined;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const ids = new Set<number>();
    for (const n of nodes) if (n.code.toLowerCase().includes(term) || n.name.toLowerCase().includes(term)) {
      for (let p: OrgNode | undefined = n; p && !ids.has(p.id); p = byId.get(p.parentId ?? -1)) ids.add(p.id);
    }
    return ids;
  }, [nodes, term]);
  const open = (id: number) => shown ? shown.has(id) : expanded.has(id);
  const toggle = (id: number) => setExpanded(previous => {
    const next = new Set(previous);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const refresh = () => qc.invalidateQueries({ queryKey: [PATH] });

  const renderLevel = (parentId: number | null, depth: number) => (children.get(parentId) ?? [])
    .filter(n => !shown || shown.has(n.id))
    .map(n => {
      const kids = (children.get(n.id) ?? []).filter(c => !shown || shown.has(c.id));
      return <Box key={n.id} component="li" sx={{ listStyle: 'none' }}>
        <ListItemButton dense selected={n.id === initialId} onClick={() => navigate(`/org-units/${n.id}`)}
          sx={{ pl: 1 + depth * 2, color: n.isActive ? undefined : 'text.disabled' }}>
          <IconButton size="small" edge="start" aria-label={t(open(n.id) ? 'orgUnits.collapse' : 'orgUnits.expand', { code: n.code })}
            sx={{ visibility: kids.length ? 'visible' : 'hidden', mr: 0.5 }} onClick={event => { event.stopPropagation(); toggle(n.id); }}>
            {open(n.id) ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
          </IconButton>
          <ListItemText primary={<OverflowTooltip text={label(n)} />}
            secondary={[!n.isActive && t('common.inactive'), kids.length && t('orgUnits.childCount', { count: children.get(n.id)!.length }),
              t('orgUnits.memberCount', { count: n.memberCount ?? 0 })].filter(Boolean).join(' · ')}
            slotProps={{ primary: { variant: 'body2', component: 'div' }, secondary: { variant: 'caption' } }} sx={{ minWidth: 0 }} />
        </ListItemButton>
        {kids.length > 0 && <Collapse in={open(n.id)} unmountOnExit><List disablePadding>{renderLevel(n.id, depth + 1)}</List></Collapse>}
      </Box>;
    });

  return (
    <>
      <ListPageLayout fill title={t('nav.orgUnits')} error={tree.error}
        actions={canManage && <ActionButton action="add" onClick={() => setDialog({ parentId: null })}>{t('orgUnits.create')}</ActionButton>}>
        {/* Fill screens: both panels take the remaining height and scroll on their own; search/toolbar and unit header stay put. */}
        <Stack data-fill-grow direction={{ xs: 'column', md: 'row' }} spacing={2}
          sx={{ alignItems: 'flex-start', [fillMedia]: { flex: '1 1 0', minHeight: 0, alignItems: 'stretch' } }}>
          <Paper sx={{ width: { xs: '100%', md: '30%' }, minWidth: { md: 280 }, flexShrink: 0, p: 1.5,
            [fillMedia]: { display: 'flex', flexDirection: 'column', minHeight: 0 } }}>
            <Stack spacing={1} sx={{ flexShrink: 0, pb: 1 }}>
              <SearchInput label={t('common.search')} placeholder={t('searchFields.codeOrName')} value={q} onChange={setQ} />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {([['expandAll', ExpandAllIcon, () => setExpanded(new Set(nodes.map(n => n.id)))],
                  ['collapseAll', CollapseAllIcon, () => setExpanded(new Set())]] as const).map(([key, Icon, onClick]) =>
                  <Tooltip key={key} title={t(`orgUnits.${key}`)}>
                    {/* F09 Tree View pattern: 32×32 neutral icon buttons, tooltip names the action. */}
                    <IconButton aria-label={t(`orgUnits.${key}`)} onClick={onClick}
                      sx={{ width: 32, height: 32, borderRadius: 1, color: 'text.secondary' }}><Icon fontSize="small" /></IconButton>
                  </Tooltip>)}
                <Box sx={{ flex: 1 }} />
                <ActionButton action="refresh" size="small" disabled={tree.isFetching} onClick={() => void refresh()} sx={{ height: 32 }}>{t('common.refresh')}</ActionButton>
              </Stack>
            </Stack>
            <Box sx={{ [fillMedia]: { flex: '1 1 0', minHeight: 0, overflowY: 'auto' } }}>
              {tree.isSuccess && (shown?.size === 0 || !nodes.length)
                ? <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>{t(nodes.length ? 'orgUnits.noMatch' : 'orgUnits.empty')}</Typography>
                : <List dense disablePadding aria-label={t('nav.orgUnits')}>{renderLevel(null, 0)}</List>}
            </Box>
          </Paper>
          <Box sx={{ flex: 1, minWidth: 0, width: '100%', [fillMedia]: { display: 'flex', flexDirection: 'column', minHeight: 0 } }}>
            {initialId ? <OrgUnitDetail key={initialId} id={initialId} canManage={canManage}
              childCount={children.get(initialId)?.length ?? 0} memberCount={nodes.find(n => n.id === initialId)?.memberCount ?? 0} activeChildCount={children.get(initialId)?.filter(c => c.isActive).length ?? 0}
              onAddChild={parentId => setDialog({ parentId })} onEdit={edit => setDialog({ edit })} onResult={setResult} onChanged={refresh} />
              : <Paper sx={{ p: 3 }}><Typography color="text.secondary">{t('orgUnits.selectHint')}</Typography></Paper>}
          </Box>
        </Stack>
      </ListPageLayout>
      {dialog && <OrgUnitDialog nodes={nodes} subtreeOf={id => subtree(children, id)}
        unit={'edit' in dialog ? dialog.edit : undefined} parentId={'edit' in dialog ? dialog.edit.parent?.id ?? null : dialog.parentId}
        onClose={() => setDialog(undefined)} onFailed={setResult}
        onSaved={(saved, id) => { setDialog(undefined); setResult(saved); void refresh(); if (id) navigate(`/org-units/${id}`); }} />}
      {result && <ActionResultDialog result={result} onClose={() => setResult(undefined)} />}
    </>
  );
}

/** F01: the native-looking tooltip only when the text is cut by the ellipsis. */
function OverflowTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <Tooltip title={text} open={open} onClose={() => setOpen(false)} enterDelay={400}
    onOpen={event => { const el = event.currentTarget as HTMLElement; setOpen(el.scrollWidth > el.clientWidth); }}>
    <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</Box>
  </Tooltip>;
}

function OrgUnitDetail({ id, canManage, childCount, memberCount, activeChildCount, onAddChild, onEdit, onResult, onChanged }: {
  id: number; canManage: boolean; childCount: number; memberCount: number; activeChildCount: number; onAddChild: (parentId: number) => void; onEdit: (unit: OrgUnit) => void;
  onResult: (result: ActionResult) => void; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('general');
  const [confirmStatus, setConfirmStatus] = useState(false);
  const unit = useQuery({ queryKey: [PATH, 'detail', id], queryFn: () => api<OrgUnit>(`${PATH}/${id}`) });
  const history = useQuery({ queryKey: [PATH, 'history', id, unit.data?.version], enabled: tab === 'history' && unit.isSuccess,
    queryFn: () => api<{ items: ActivityEntry[]; nextCursor: number | null }>(`${PATH}/${id}/history`) });
  const u = unit.data;
  const status = useMutation({
    mutationFn: () => api(`${PATH}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !u!.isActive, version: u!.version }) }),
    onSettled: () => { setConfirmStatus(false); onChanged(); },
    onSuccess: () => onResult({ success: true, message: label(u!), status: t(u!.isActive ? 'common.inactive' : 'common.active'),
      title: t('master.resultSuccess', { action: t(u!.isActive ? 'master.disable' : 'master.activate') }) }),
    onError: error => onResult({ success: false, error, message: label(u!),
      title: t('master.resultFailure', { action: t(u!.isActive ? 'master.disable' : 'master.activate') }) }),
  });
  if (!u) return <Paper sx={{ p: 3 }}>{unit.isError ? <Typography color="error">{String((unit.error as Error).message)}</Typography>
    : <Typography color="text.secondary">{t('common.loading')}</Typography>}</Paper>;
  return (
    <Stack spacing={1.5} sx={{ [fillMedia]: { flex: '1 1 0', minHeight: 0 } }}>
      <Paper sx={{ p: 2, flexShrink: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{u.name}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">{u.code}</Typography>
              <ActiveChip active={u.isActive} />
            </Stack>
          </Box>
          {canManage && <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {/* F05: blocked up front from the loaded tree; the server still enforces ORG_UNIT_HAS_ACTIVE_CHILDREN. */}
            {/* ORG_UNIT_IN_USE: ACTIVE memberships block it too (server re-checks under org-tree). */}
            <Tooltip title={!u.isActive ? '' : activeChildCount ? t('orgUnits.disableBlocked', { count: activeChildCount }) : memberCount ? t('orgUnits.disableBlockedMembers', { count: memberCount }) : ''}>
              <span><ActionButton action={u.isActive ? 'void' : 'confirm'} variant="outlined" disabled={u.isActive && (activeChildCount > 0 || memberCount > 0)}
                onClick={() => setConfirmStatus(true)}>{t(u.isActive ? 'master.disable' : 'master.activate')}</ActionButton></span>
            </Tooltip>
            <ActionButton action="add" variant="outlined" disabled={!u.isActive} onClick={() => onAddChild(u.id)}>{t('orgUnits.addChild')}</ActionButton>
            <ActionButton action="edit" onClick={() => onEdit(u)}>{t('master.editAction')}</ActionButton>
          </Stack>}
        </Stack>
      </Paper>
      <DetailTabs value={tab} onChange={setTab} tabs={[
        { key: 'general', label: t('orgUnits.tabGeneral'), content: <DocumentFormGrid>
          <DocumentFormCell span={4}><ReadOnlyField label={t('orgUnits.code')} value={u.code} /></DocumentFormCell>
          <DocumentFormCell span={8}><ReadOnlyField label={t('orgUnits.name')} value={u.name} /></DocumentFormCell>
          <DocumentFormCell span={6}><ReadOnlyField label={t('orgUnits.parent')} value={u.parent ? label(u.parent) : t('orgUnits.root')} /></DocumentFormCell>
          <DocumentFormCell span={6}><ReadOnlyField label={t('orgUnits.head')} value={u.head ? personLabel(u.head) : t('orgUnits.headNone')} helperText={u.head ? undefined : t('orgUnits.headPending')} /></DocumentFormCell>
          <DocumentFormCell span={3}><ReadOnlyField label={t('orgUnits.childUnits')} value={String(childCount)} /></DocumentFormCell>
          <DocumentFormCell span={3}><ReadOnlyField label={t('orgUnits.members')} value={String(memberCount)} /></DocumentFormCell>
          <DocumentFormCell span={12}><ReadOnlyField label={t('master.fields.description')} value={u.description ?? ''} multiline minRows={2} /></DocumentFormCell>
        </DocumentFormGrid> },
        { key: 'members', label: `${t('orgUnits.tabMembers')} (${memberCount})`, content:
          <OrgUnitMembers unit={u} canManage={canManage} onResult={onResult} onChanged={onChanged} /> },
        { key: 'history', label: t('orgUnits.tabHistory'), content: history.data
          ? <DocumentRecordList key={u.version} path={`${PATH}/${id}/history`} items={history.data.items} nextCursor={history.data.nextCursor}
            render={items => <ActivityHistoryTable entries={items}
              actionLabel={action => t(`orgUnits.history.${action}`, { defaultValue: action })}
              fieldLabel={field => t(`orgUnits.${field}`, { defaultValue: field })} listLabel={key => key} />} />
          : <Typography variant="body2" color="text.secondary">{t('common.loading')}</Typography> },
      ]} />
      {confirmStatus && <FormDialog title={t(u.isActive ? 'orgUnits.disableTitle' : 'orgUnits.enableTitle')} description={label(u)}
        submitLabel={t(u.isActive ? 'master.disable' : 'master.activate')} submitAction={u.isActive ? 'void' : 'confirm'}
        pending={status.isPending} canSubmit error={null} onClose={() => setConfirmStatus(false)} onSubmit={() => status.mutate()}>
        {t(u.isActive ? 'orgUnits.disableHint' : 'orgUnits.enableHint')}
      </FormDialog>}
    </Stack>
  );
}

function OrgUnitDialog({ nodes, subtreeOf, unit, parentId, onClose, onSaved, onFailed }: {
  nodes: OrgNode[]; subtreeOf: (id: number) => Set<number>; unit?: OrgUnit; parentId: number | null;
  onClose: () => void; onSaved: (result: ActionResult, id?: number) => void; onFailed: (result: ActionResult) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState({ code: unit?.code ?? '', name: unit?.name ?? '', description: unit?.description ?? '', parentId, headUserId: unit?.headUserId ?? null });
  // BA-ORG-10: the head is picked among the unit's ACTIVE members who are ACTIVE employees (server: HEAD_NOT_MEMBER, HEAD_INACTIVE).
  const members = useMembers(unit?.id ?? 0, Boolean(unit));
  const headOptions = (members.data ?? []).filter(m => m.employmentStatus === 'ACTIVE' || m.id === value.headUserId);
  const [touched, setTouched] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const moved = Boolean(unit) && value.parentId !== (unit?.parent?.id ?? null);
  const dirty = value.code !== (unit?.code ?? '') || value.name !== (unit?.name ?? '') || value.description !== (unit?.description ?? '') || value.parentId !== parentId
    || value.headUserId !== (unit?.headUserId ?? null);
  // Active units only, and never the unit itself or its subtree (cycle); the server re-checks both.
  const blocked = unit ? subtreeOf(unit.id) : new Set<number>();
  const options = nodes.filter(n => !blocked.has(n.id) && (n.isActive || n.id === value.parentId));
  const action = t(unit ? 'doc.saveEdit' : 'master.addAction');
  const target = () => label({ code: value.code.trim(), name: value.name.trim() });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: value.name.trim(), description: value.description.trim() || null, parentId: value.parentId };
      return unit ? api(`${PATH}/${unit.id}`, { method: 'PUT', body: JSON.stringify({ ...body, version: unit.version,
          ...(value.headUserId !== unit.headUserId && { headUserId: value.headUserId }) }) })
        : api<{ id: number }>(PATH, { method: 'POST', body: JSON.stringify({ ...body, code: value.code.trim() }) });
    },
    onSuccess: created => onSaved({ success: true, title: t('master.resultSuccess', { action }), message: target() }, (created as { id?: number } | undefined)?.id),
    onError: error => {
      setConfirmMove(false);
      if (!(error instanceof ApiError && error.code === 'DUPLICATE_VALUE')) onFailed({ success: false, error, title: t('master.resultFailure', { action }), message: target() });
    },
  });
  const issues = {
    code: !value.code.trim() ? t('master.required') : !CODE.test(value.code.trim()) ? t('jobTitles.codeFormat')
      : save.error instanceof ApiError && save.error.code === 'DUPLICATE_VALUE' ? t('errors.DUPLICATE_VALUE') : undefined,
    name: !value.name.trim() ? t('master.required') : value.name.trim().length > 200 ? t('master.tooLong', { count: 200 }) : undefined,
    description: value.description.length > 1000 ? t('master.tooLong', { count: 1000 }) : undefined,
  };
  const ready = !issues.code && !issues.name && !issues.description;
  const shownIssue = (key: keyof typeof issues) => (touched || save.isError) ? issues[key] : undefined;
  const parentName = (id: number | null) => { const p = nodes.find(n => n.id === id); return p ? label(p) : t('orgUnits.root'); };
  const edit = (changes: Partial<typeof value>) => { setValue({ ...value, ...changes }); setTouched(true); save.reset(); };
  const title = unit ? t('master.edit', { name: t('orgUnits.entity') }) : parentId ? t('orgUnits.addChildTitle') : t('master.create', { name: t('orgUnits.entity') });
  return (
    <>
      <FormDialog pageGuardsNavigation title={title} dirty={dirty} pending={save.isPending} error={null}
        submitLabel={action} submitAction="save" canSubmit={ready} onClose={onClose}
        onSubmit={() => moved ? setConfirmMove(true) : save.mutate()}>
        <DocumentFormGrid>
          <DocumentFormCell span={4}>{unit ? <ReadOnlyField label={t('orgUnits.code')} value={value.code} />
            : <TextField fullWidth size="small" required label={t('orgUnits.code')} value={value.code} disabled={save.isPending}
              error={Boolean(shownIssue('code'))} helperText={shownIssue('code')} onChange={e => edit({ code: e.target.value })} />}</DocumentFormCell>
          <DocumentFormCell span={8}><TextField fullWidth size="small" required label={t('orgUnits.name')} value={value.name} disabled={save.isPending}
            error={Boolean(shownIssue('name'))} helperText={shownIssue('name')} onChange={e => edit({ name: e.target.value })} /></DocumentFormCell>
          <DocumentFormCell span={6}><TextField select fullWidth size="small" label={t('orgUnits.parent')} value={value.parentId ?? ''} disabled={save.isPending}
            onChange={e => edit({ parentId: e.target.value === '' ? null : Number(e.target.value) })}>
            <MenuItem value="">{t('orgUnits.root')}</MenuItem>
            {options.map(n => <MenuItem key={n.id} value={n.id}>{label(n)}</MenuItem>)}
          </TextField></DocumentFormCell>
          <DocumentFormCell span={6}>{unit
            ? <TextField select fullWidth size="small" label={t('orgUnits.head')} value={value.headUserId ?? ''} disabled={save.isPending}
                helperText={t('orgUnits.headPending')} onChange={e => edit({ headUserId: e.target.value === '' ? null : Number(e.target.value) })}>
                <MenuItem value="">{t('orgUnits.headNone')}</MenuItem>
                {headOptions.map(m => <MenuItem key={m.id} value={m.id}>{personLabel(m)}</MenuItem>)}
              </TextField>
            : <ReadOnlyField label={t('orgUnits.head')} value={t('orgUnits.headNone')} helperText={t('orgUnits.headAfterCreate')} />}</DocumentFormCell>
          <DocumentFormCell span={12}><TextField fullWidth size="small" multiline minRows={2} label={t('master.fields.description')} value={value.description}
            disabled={save.isPending} error={Boolean(shownIssue('description'))} helperText={shownIssue('description')} onChange={e => edit({ description: e.target.value })} /></DocumentFormCell>
          {unit && <DocumentFormCell span={4}><Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="caption">{t('common.status')}</Typography><ActiveChip active={unit.isActive} />
          </Stack></DocumentFormCell>}
        </DocumentFormGrid>
      </FormDialog>
      {confirmMove && unit && <FormDialog title={t('orgUnits.moveTitle')} description={label(unit)} submitLabel={t('orgUnits.moveConfirm')} submitAction="confirm"
        pending={save.isPending} canSubmit error={null} onClose={() => setConfirmMove(false)} onSubmit={() => save.mutate()}>
        <Stack spacing={1}>
          <Typography variant="body2">{t('orgUnits.moveFromTo', { from: parentName(unit.parent?.id ?? null), to: parentName(value.parentId) })}</Typography>
          <Typography variant="body2" color="warning.main">{t('orgUnits.moveWarning')}</Typography>
        </Stack>
      </FormDialog>}
    </>
  );
}
