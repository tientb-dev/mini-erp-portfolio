import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, Typography } from '@mui/material';
import { api, ApiError } from '../../services/api-client';
import { ActionResultDialog, DetailPageLayout, DetailTabs, FormDialog } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { ActionButton } from '../../shared/components/ActionButton';
import { ActivityHistoryTable } from '../../shared/components/ActivityHistoryTable';
import { DocumentRecordList } from '../../shared/components/DocumentRecordList';
import { RouteDiscardGuard } from '../../shared/components/FormDialog';
import { useMe } from '../identity';
import { EmploymentChip } from './UserChips';
import { EmploymentDialog } from './UserAccount';
import { Draft, Field, GeneralTab, validate } from './UserGeneralTab';
import { OrgTab, RefListTab } from './UserRelationTabs';
import { Ref, refLabel, USERS, userKey, useUser, useUserHistory } from './users-api';

const sameIds = (a: { id: number }[], b: { id: number }[]) => a.length === b.length && a.every(x => b.some(y => y.id === x.id));
const membershipKey = (d: Draft) => JSON.stringify(d.memberships.map(m => [m.orgUnit.id, m.jobTitle.id, m.manager?.id ?? null, m.isPrimary]).sort());
/** MEMBERSHIPS_CHANGED items: `{orgUnit, jobTitle, isPrimary}` or `{before, after}` of one unit. */
function membershipLabel(item: unknown, primary: string): string | undefined {
  const m = item as { orgUnit?: Ref; jobTitle?: Ref; isPrimary?: boolean; before?: unknown; after?: unknown } | null;
  if (m?.before && m.after) return `${membershipLabel(m.before, primary)} → ${membershipLabel(m.after, primary)}`;
  if (!m?.orgUnit) return undefined;
  return `${refLabel(m.orgUnit)} — ${m.jobTitle?.name ?? ''}${m.isPrimary ? ` (${primary})` : ''}`;
}
const FIELD_ERRORS: Record<string, Field> = { EMPLOYEE_CODE_TAKEN: 'employeeCode', USERNAME_TAKEN: 'username', PASSWORD_POLICY: 'password' };
const TAB_OF_ERROR: Record<string, string> = {
  PRIMARY_ORG_UNIT_REQUIRED: 'org', MEMBERSHIP_DUPLICATE_UNIT: 'org', ORG_UNIT_NOT_FOUND: 'org', ORG_UNIT_INACTIVE: 'org', JOB_TITLE_NOT_FOUND: 'org',
  JOB_TITLE_INACTIVE: 'org', MANAGER_SELF: 'org', MANAGER_NOT_FOUND: 'org', MANAGER_INACTIVE: 'org', MANAGER_CYCLE: 'org', ORG_UNIT_HEAD_MEMBERSHIP: 'org',
  UNKNOWN_ROLE: 'roles', NO_ACCOUNT: 'roles', LAST_ADMIN: 'roles', UNKNOWN_WAREHOUSE: 'scope', WAREHOUSE_INACTIVE: 'scope',
};

/**
 * Create / View / Edit of one employee (BA-UI-04) on the Common Full Page Detail. Every tab edits one draft held here, so
 * switching tabs or a failed save keeps the input; one Save sends profile, memberships, roles and warehouses in a single
 * request (atomic on the server). Account security actions are separate, each with its own confirmation (UserAccount).
 */
export function UserDetailPage({ id, startEditing, backTo }: { id: number; startEditing: boolean; backTo: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe().data;
  const router = useContext(UNSAFE_DataRouterContext);
  const locationState = useLocation().state as { userResult?: ActionResult } | null;
  const canManage = Boolean(me?.permissions.includes('USER.MANAGE'));
  const creating = id === 0;
  const self = !creating && me?.id === id;
  const user = useUser(id, !creating);
  const loaded = user.data;
  const initial = useMemo<Draft | undefined>(() => creating
    ? { employeeCode: '', fullName: '', email: '', phone: '', withAccount: false, username: '', password: '', memberships: [], roles: [], warehouses: [] }
    : loaded && { employeeCode: loaded.employeeCode, fullName: loaded.fullName, email: loaded.email ?? '', phone: loaded.phone ?? '', withAccount: false,
      username: '', password: '', memberships: loaded.memberships, roles: loaded.roles, warehouses: loaded.warehouses }, [creating, loaded]);
  const [draft, setDraft] = useState<Draft>();
  const [editRequested, setEditing] = useState(creating || startEditing);
  const editing = editRequested && canManage;
  const [tab, setTab] = useState('general');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [employment, setEmployment] = useState(false);
  const [result, setResult] = useState<ActionResult | undefined>(locationState?.userResult);
  const [created, setCreated] = useState<{ id: number; result: ActionResult }>();
  const refs = { employeeCode: useRef<HTMLInputElement>(null), fullName: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null), username: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };
  useEffect(() => {
    if (created && !editing) navigate(`/users/${created.id}`, { replace: true, state: { listSearch: backTo.replace(/^\/users/, ''), userResult: created.result } });
  }, [created, editing, navigate, backTo]);
  const history = useUserHistory(id, loaded?.version, tab === 'history' && Boolean(loaded));
  const value = draft ?? initial;
  const changed = value && initial ? {
    profile: (['fullName', 'email', 'phone'] as const).some(k => value[k].trim() !== initial[k].trim()) || value.employeeCode !== initial.employeeCode || value.withAccount,
    memberships: membershipKey(value) !== membershipKey(initial), roles: !sameIds(value.roles, initial.roles), warehouses: !sameIds(value.warehouses, initial.warehouses),
  } : undefined;
  const dirty = Boolean(draft && changed && Object.values(changed).some(Boolean));
  const rules = value ? validate(value, creating, t) : {};
  const errorOf = (field: Field) => (submitted || touched[field] ? rules[field] : undefined) ?? serverErrors[field];
  const update = (changes: Partial<Draft>) => {
    setDraft(previous => ({ ...(previous ?? initial!), ...changes }));
    setServerErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !(key in changes))));
  };
  const refresh = async () => { await qc.invalidateQueries({ queryKey: [USERS] }); await qc.invalidateQueries({ queryKey: ['/admin/org-units'] }); };

  const save = useMutation({
    mutationFn: async () => {
      const v = value!;
      const profile = { fullName: v.fullName.trim(), email: v.email.trim() || null, phone: v.phone.trim() || null };
      const memberships = v.memberships.map(m => ({ orgUnitId: m.orgUnit.id, jobTitleId: m.jobTitle.id, managerUserId: m.manager?.id ?? null, isPrimary: m.isPrimary }));
      // Absent lists stay unchanged on the server (no needless grant gate, no self-change on parts not edited).
      const relations = {
        ...((creating || changed!.memberships) && { memberships }), ...((creating || changed!.roles) && { roleIds: v.roles.map(r => r.id) }),
        ...((creating || changed!.warehouses) && { warehouseIds: v.warehouses.map(w => w.id) }),
      };
      if (creating) return api<{ id: number }>(USERS, { method: 'POST', body: JSON.stringify({ profile: { ...profile, employeeCode: v.employeeCode.trim() },
        ...(v.withAccount && { account: { username: v.username.trim(), initialPassword: v.password } }), ...relations }) });
      await api(`${USERS}/${id}`, { method: 'PUT', body: JSON.stringify({ profile, ...relations, version: loaded!.version }) });
      return { id };
    },
    onSuccess: async ({ id: saved }) => {
      setConfirmSave(false);
      await refresh();
      await qc.invalidateQueries({ queryKey: userKey(saved) });
      await qc.invalidateQueries({ queryKey: ['/admin/roles'] });
      setDraft(undefined);
      setEditing(false);
      setSubmitted(false);
      setTouched({});
      const done: ActionResult = { success: true, title: t(creating ? 'users.created' : 'users.saved'), message: `${value!.employeeCode.trim()} · ${value!.fullName.trim()}` };
      if (creating) setCreated({ id: saved, result: done }); else setResult(done);
    },
    onError: error => {
      setConfirmSave(false);
      const code = error instanceof ApiError ? error.code ?? '' : '';
      const field = FIELD_ERRORS[code];
      if (field) {
        setServerErrors({ [field]: t(`errors.${code}`) });
        setTab('general');
        queueMicrotask(() => refs[field].current?.focus());
      } else if (TAB_OF_ERROR[code]) setTab(TAB_OF_ERROR[code]);
      setResult({ success: false, error, title: t('users.saveFailed'), hint: code === 'VERSION_CONFLICT' ? t('users.conflictHint') : undefined });
    },
  });

  const title = creating ? t('users.createTitle') : t('users.detailTitle');
  if (!value) return <DetailPageLayout title={title} loading error={user.error} backTo={backTo} />;
  const requestSave = () => {
    const first = (Object.keys(refs) as Field[]).find(field => rules[field]);
    if (first) {
      setSubmitted(true);
      setTab('general');
      queueMicrotask(() => refs[first].current?.focus());
      return;
    }
    if (!creating && (changed!.roles || changed!.warehouses)) setConfirmSave(true); else save.mutate();
  };
  const cancelEdit = () => {
    if (creating) { navigate(backTo); return; }
    setDraft(undefined); setEditing(false); setSubmitted(false); setTouched({}); setServerErrors({});
  };
  const active = loaded?.employmentStatus === 'ACTIVE';
  const footer = editing
    ? <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <ActionButton action="cancel" onClick={cancelEdit} disabled={save.isPending}>{t('common.cancel')}</ActionButton>
        <ActionButton action="save" onClick={requestSave} disabled={save.isPending}>{t('users.save')}</ActionButton>
      </Stack>
    : canManage && loaded && <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {!self && (active ? <ActionButton action="void" onClick={() => setEmployment(true)}>{t('users.deactivate')}</ActionButton>
          : <ActionButton action="confirm" variant="outlined" onClick={() => setEmployment(true)}>{t('users.activate')}</ActionButton>)}
        <ActionButton action="edit" onClick={() => setEditing(true)}>{t('users.edit')}</ActionButton>
      </Stack>;
  const relationsLocked = !editing || self;
  const touch = (field: Field) => setTouched(previous => ({ ...previous, [field]: true }));
  const added = (key: 'roles' | 'warehouses') => value[key].filter(x => !initial![key].some(y => y.id === x.id));
  const removed = (key: 'roles' | 'warehouses') => initial![key].filter(x => !value[key].some(y => y.id === x.id));

  return (
    <>
      <DetailPageLayout title={title} documentNumber={creating ? undefined : loaded?.employeeCode} backTo={backTo}
        status={loaded && <EmploymentChip status={loaded.employmentStatus} prominent />} subtitle={loaded?.fullName} footer={footer || undefined}>
        <DetailTabs value={tab} onChange={setTab} tabs={[
          { key: 'general', label: t('users.tabGeneral'), invalid: (Object.keys(refs) as Field[]).some(f => errorOf(f)), content:
            <GeneralTab value={value} user={loaded} editing={editing} creating={creating} self={self} canManage={canManage}
              errorOf={errorOf} refs={refs} onTouch={touch} onChange={update} onResult={setResult} onChanged={refresh} /> },
          { key: 'org', label: t('users.tabOrg'), content:
            <OrgTab employee={loaded ?? { id: 0, employeeCode: value.employeeCode, fullName: value.fullName }} memberships={value.memberships}
              readOnly={relationsLocked} self={self} onChange={memberships => update({ memberships })} /> },
          { key: 'roles', label: t('users.tabRoles'), content:
            <RefListTab kind="roles" items={value.roles} readOnly={relationsLocked} self={self} onChange={roles => update({ roles })}
              blockedReason={(creating ? !value.withAccount : !loaded?.username) ? t('users.rolesNeedAccount') : undefined} /> },
          { key: 'scope', label: t('users.tabScope'), content:
            <RefListTab kind="warehouses" items={value.warehouses} readOnly={relationsLocked} self={self} onChange={warehouses => update({ warehouses })} /> },
          { key: 'history', label: t('users.tabHistory'), hidden: creating, content: history.data
            ? <DocumentRecordList key={loaded?.version} path={`${USERS}/${id}/history`} items={history.data.items} nextCursor={history.data.nextCursor}
                render={items => <ActivityHistoryTable entries={items} actionLabel={action => t(`users.history.${action}`, { defaultValue: action })}
                  fieldLabel={field => t(`users.${field}`, { defaultValue: field })} formatItem={item => membershipLabel(item, t('users.primaryMark'))}
                  // F07: security times to the second; the automatic lock shows the system as its cause (stored actor kept).
                  withSeconds scalarFields={['username', 'minutes']}
                  actorLabel={entry => (entry.action === 'ACCOUNT_LOCKED' ? t('users.systemActor', { name: entry.actorName }) : entry.actorName)}
                  listLabel={(key, action) => t(`users.historyList.${action}.${key}`, { defaultValue: key })} />} />
            : <Typography variant="body2" color="text.secondary">{t('common.loading')}</Typography> },
        ]} />
      </DetailPageLayout>
      {editing && router && <RouteDiscardGuard dirty={dirty} pending={save.isPending} />}
      {confirmSave && <FormDialog title={t('users.confirmSaveTitle')} description={`${value.employeeCode} · ${value.fullName}`} submitLabel={t('users.save')}
        submitAction="save" pending={save.isPending} canSubmit error={null} onClose={() => setConfirmSave(false)} onSubmit={() => save.mutate()}>
        <Stack spacing={1}>
          {(['roles', 'warehouses'] as const).flatMap(key => [[key, 'added', added(key)], [key, 'removed', removed(key)]] as const)
            .filter(([, , list]) => list.length).map(([key, kind, list]) =>
              <Typography key={`${key}-${kind}`}>{t(`users.impact.${key}_${kind}`, { list: list.map(x => x.code).join(', ') })}</Typography>)}
          <Typography color="text.secondary">{t('users.impact.nextRequest')}</Typography>
        </Stack>
      </FormDialog>}
      {employment && loaded && <EmploymentDialog user={loaded} onClose={() => setEmployment(false)} onResult={setResult} onChanged={refresh} />}
      {result && <ActionResultDialog result={result} onClose={() => setResult(undefined)} />}
    </>
  );
}
