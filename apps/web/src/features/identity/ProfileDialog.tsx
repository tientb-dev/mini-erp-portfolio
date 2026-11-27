import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Chip, Stack, TextField, Typography } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import { api, ApiError } from '../../services/api-client';
import { ActionResultDialog, DetailTabs, FormDialog, StatusChip } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { fmtDay } from '../../shared/utils/format';

interface Ref { id: number; code: string; name: string }
interface Person { id: number; employeeCode: string; fullName: string }
interface Profile {
  id: number; employeeCode: string; fullName: string; email: string | null; phone: string | null; employmentStatus: 'ACTIVE' | 'INACTIVE';
  username: string | null; accountStatus: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'NONE'; version: number; primaryOrgUnit: Ref | null; primaryJobTitle: Ref | null;
  memberships: { orgUnit: Ref; jobTitle: Ref; isPrimary: boolean; manager: Person | null; isHead: boolean; startedAt: string }[];
  roles: (Ref & { isActive: boolean })[];
}
type Field = 'email' | 'phone';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\s-]*$/;
const ref = (r: Ref | null) => (r ? `${r.code} · ${r.name}` : '');
const person = (p: Person | null) => (p ? `${p.employeeCode} · ${p.fullName}` : '');

/**
 * Hồ sơ cá nhân (BA-UI-07, OA2.4): own employee, account, organization and roles read-only; only email and phone are
 * editable (BA-USR-09; the API rejects any other field). Saved with the profile version; a conflict keeps the input.
 */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // F04: every opening reads the latest profile (no cached copy is kept after closing).
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api<Profile>('/me'), gcTime: 0, refetchOnMount: 'always' });
  const p = profile.isFetchedAfterMount ? profile.data : undefined;
  const [tab, setTab] = useState('general');
  const [draft, setDraft] = useState<Record<Field, string>>();
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [result, setResult] = useState<ActionResult>();
  const refs = { email: useRef<HTMLInputElement>(null), phone: useRef<HTMLInputElement>(null) };
  const initial = { email: p?.email ?? '', phone: p?.phone ?? '' };
  const value = draft ?? initial;
  const dirty = Boolean(draft) && (value.email.trim() !== initial.email || value.phone.trim() !== initial.phone);
  const issues: Partial<Record<Field, string>> = {
    ...(value.email.trim() && !EMAIL.test(value.email.trim()) ? { email: t('users.emailFormat') } : {}),
    ...(!PHONE.test(value.phone) ? { phone: t('users.phoneFormat') } : {}),
  };
  const save = useMutation({
    mutationFn: () => api('/me', { method: 'PATCH', body: JSON.stringify({ email: value.email.trim() || null, phone: value.phone.trim() || null, version: p!.version }) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'], exact: true });
      setDraft(undefined);
      setTouched({});
      setResult({ success: true, title: t('profile.saved'), message: `${p!.employeeCode} · ${p!.fullName}` });
    },
    // VERSION_CONFLICT: the input stays as typed; no automatic reload or retry.
    onError: error => setResult({ success: false, error, title: t('profile.saveFailed'),
      hint: error instanceof ApiError && error.code === 'VERSION_CONFLICT' ? t('profile.conflictHint') : undefined }),
  });
  const submit = () => {
    const first = (['email', 'phone'] as Field[]).find(f => issues[f]);
    if (first) {
      setTouched({ email: true, phone: true });
      setTab('general');
      queueMicrotask(() => refs[first].current?.focus());
      return;
    }
    save.mutate();
  };
  const input = (field: Field, max: number) => {
    const error = touched[field] ? issues[field] : undefined;
    return <TextField fullWidth size="small" label={t(`users.${field}`)} value={value[field]} inputRef={refs[field]} error={Boolean(error)} helperText={error}
      disabled={save.isPending} onBlur={() => setTouched(previous => ({ ...previous, [field]: true }))}
      onChange={e => setDraft({ ...value, [field]: e.target.value })} slotProps={{ htmlInput: { maxLength: max }, inputLabel: { shrink: true } }} />;
  };
  const section = (title: string) => <DocumentFormCell span={12}><Typography variant="subtitle2" sx={{ mt: 1 }}>{title}</Typography></DocumentFormCell>;
  const check = (on: boolean, label: string) => on && <CheckCircle fontSize="small" color="success" titleAccess={label} sx={{ verticalAlign: 'middle' }} />;
  const invalid = Boolean((touched.email && issues.email) || (touched.phone && issues.phone));
  return (
    <>
      {/* F01: one FormDialog (~900px), three tabs over one draft so switching tabs keeps the input; F04: Save only when changed. */}
      <FormDialog title={t('account.profile')} width={900}
        submitLabel={t('profile.save')} submitAction="save" dirty={dirty} pending={save.isPending} canSubmit={Boolean(p) && dirty}
        error={profile.error} onClose={onClose} onSubmit={submit}>
        {!p ? <Typography color="text.secondary">{t('common.loading')}</Typography> : <Stack spacing={1.5}>
          <Alert severity="info">{t('profile.editHint')}</Alert>
          <DetailTabs value={tab} onChange={setTab} tabs={[
            { key: 'general', label: t('users.tabGeneral'), invalid, content: <DocumentFormGrid>
              {section(t('profile.employee'))}
              <DocumentFormCell span={4}><ReadOnlyField label={t('users.employeeCode')} value={p.employeeCode} /></DocumentFormCell>
              <DocumentFormCell span={5}><ReadOnlyField label={t('users.fullName')} value={p.fullName} /></DocumentFormCell>
              <DocumentFormCell span={3}><StatusLine label={t('users.employmentStatus')}>
                <StatusChip label={t(`users.employment.${p.employmentStatus}`)} tone={p.employmentStatus === 'ACTIVE' ? 'success' : 'muted'} /></StatusLine></DocumentFormCell>
              <DocumentFormCell span={6}>{input('email', 200)}</DocumentFormCell>
              <DocumentFormCell span={6}>{input('phone', 50)}</DocumentFormCell>
              {section(t('profile.account'))}
              <DocumentFormCell span={4}><ReadOnlyField label={t('users.username')} value={p.username ?? ''} /></DocumentFormCell>
              <DocumentFormCell span={4}><StatusLine label={t('users.accountStatus')}>
                <StatusChip label={t(`users.account.${p.accountStatus}`)} tone={p.accountStatus === 'ACTIVE' ? 'success' : 'muted'} /></StatusLine></DocumentFormCell>
            </DocumentFormGrid> },
            { key: 'org', label: t('users.tabOrg'), content: <DocumentFormGrid>
              <DocumentFormCell span={6}><ReadOnlyField label={t('users.primaryOrgUnit')} value={ref(p.primaryOrgUnit)} /></DocumentFormCell>
              <DocumentFormCell span={6}><ReadOnlyField label={t('users.primaryJobTitle')} value={p.primaryJobTitle?.name ?? ''} /></DocumentFormCell>
              <DocumentFormCell span={12}>
                {p.memberships.length ? <Box component="table" aria-label={t('profile.memberships')} sx={{ width: '100%', borderCollapse: 'collapse',
                  '& th, & td': { textAlign: 'left', py: 0.75, px: 1, borderBottom: 1, borderColor: 'divider', fontSize: 14 },
                  '& th': { bgcolor: '#E8EEF5', fontWeight: 600, color: '#334155' }, '& .c': { textAlign: 'center' } }}>
                  <thead><tr><th>{t('users.orgUnit')}</th><th>{t('users.jobTitle')}</th><th className="c">{t('users.primaryUnit')}</th>
                    <th className="c">{t('orgUnits.head')}</th><th>{t('users.manager')}</th><th>{t('users.startedAt')}</th></tr></thead>
                  <tbody>{p.memberships.map(m => <tr key={m.orgUnit.id}>
                    <td>{ref(m.orgUnit)}</td><td>{m.jobTitle.name}</td><td className="c">{check(m.isPrimary, t('users.primaryUnit'))}</td>
                    <td className="c">{check(m.isHead, t('orgUnits.head'))}</td><td>{person(m.manager) || '—'}</td><td>{fmtDay(m.startedAt)}</td></tr>)}</tbody>
                </Box> : <Typography variant="body2" color="text.secondary">{t('users.noMemberships')}</Typography>}
              </DocumentFormCell>
            </DocumentFormGrid> },
            { key: 'roles', label: t('users.tabRoles'), content: p.roles.length
              ? <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {p.roles.map(r => <Chip key={r.id} size="small" variant="outlined" label={r.isActive ? ref(r) : `${ref(r)} (${t('common.inactive')})`} />)}
                </Stack>
              : <Typography variant="body2" color="text.secondary">{t('users.no_roles')}</Typography> },
          ]} />
        </Stack>}
      </FormDialog>
      {/* F04: once the success result closes, the profile closes too, back to the untouched screen underneath. */}
      {result && <ActionResultDialog result={result} onClose={() => { const ok = result.success; setResult(undefined); if (ok) onClose(); }} />}
    </>
  );
}

function StatusLine({ label, children }: { label: string; children: React.ReactNode }) {
  return <Box>
    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, lineHeight: '20px', mb: 0.5 }}>{label}</Typography>
    <Box sx={{ height: 40, display: 'flex', alignItems: 'center' }}>{children}</Box>
  </Box>;
}
