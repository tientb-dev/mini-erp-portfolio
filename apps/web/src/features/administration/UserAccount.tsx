import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Box, Stack, TextField, Tooltip, Typography } from '@mui/material';
import LockOpen from '@mui/icons-material/LockOpenOutlined';
import Key from '@mui/icons-material/KeyOutlined';
import { api, ApiError } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { ActionButton } from '../../shared/components/ActionButton';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { fmtDate } from '../../shared/utils/format';
import { PasswordField } from '../identity';
import { AccountChip } from './UserChips';
import { USERS, UserDetail } from './users-api';

type Kind = 'create' | 'reset' | 'disable' | 'enable' | 'unlock';
const PASSWORD_MIN = 12;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,99}$/;

/**
 * Account block of a saved employee (§9): its own actions, each with its own confirmation and the employee `version`
 * (OA2.3b F01), separate from the centralized Save. Enabling never follows employment reactivation (BA-USR-04).
 */
export function AccountPanel({ user, actions, self, onResult, onChanged }: {
  user: UserDetail; actions: boolean; self: boolean; onResult: (result: ActionResult) => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>();
  const employed = user.employmentStatus === 'ACTIVE';
  const has = user.accountStatus !== 'NONE';
  return (
    <Stack spacing={1.5}>
      <DocumentFormGrid>
        <DocumentFormCell span={4}><ReadOnlyField label={t('users.username')} value={user.username ?? ''} /></DocumentFormCell>
        {/* F02: the badge sits on the 40px input row, vertically centred like the values beside it. */}
        <DocumentFormCell span={3}><Box>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, lineHeight: "20px", mb: 0.5 }}>{t('users.accountStatus')}</Typography>
          <Box sx={{ height: 40, display: "flex", alignItems: "center" }}><AccountChip status={user.accountStatus} /></Box>
        </Box></DocumentFormCell>
        {has && <DocumentFormCell span={2}><ReadOnlyField label={t('users.mustChange')} value={t(user.mustChangePassword ? 'common.yes' : 'common.no')} /></DocumentFormCell>}
        {user.lockedUntil && <DocumentFormCell span={3}><ReadOnlyField label={t('users.lockedUntil')} value={fmtDate(user.lockedUntil)} /></DocumentFormCell>}
      </DocumentFormGrid>
      {self && <Typography variant="body2" color="text.secondary">{t('users.selfAccountHint')}</Typography>}
      {actions && <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        {!has ? <Tooltip title={employed ? '' : t('users.accountNeedsEmployment')}><span>
            <ActionButton action="add" variant="outlined" disabled={!employed} onClick={() => setKind('create')}>{t('users.createAccount')}</ActionButton></span></Tooltip>
          : <>
            <ActionButton action="refresh" startIcon={<Key />} onClick={() => setKind('reset')}>{t('users.resetPassword')}</ActionButton>
            {user.accountActive ? <ActionButton action="void" onClick={() => setKind('disable')}>{t('users.disableAccount')}</ActionButton>
              : <Tooltip title={employed ? '' : t('users.accountNeedsEmployment')}><span>
                  <ActionButton action="confirm" variant="outlined" disabled={!employed} onClick={() => setKind('enable')}>{t('users.enableAccount')}</ActionButton></span></Tooltip>}
            {user.accountStatus === 'LOCKED' && <ActionButton action="confirm" variant="outlined" startIcon={<LockOpen />} onClick={() => setKind('unlock')}>{t('users.unlock')}</ActionButton>}
          </>}
      </Stack>}
      {kind && <AccountDialog kind={kind} user={user} onClose={() => setKind(undefined)} onResult={onResult} onChanged={onChanged} />}
    </Stack>
  );
}

function AccountDialog({ kind, user, onClose, onResult, onChanged }: {
  kind: Kind; user: UserDetail; onClose: () => void; onResult: (result: ActionResult) => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const needsPassword = kind === 'create' || kind === 'reset';
  const issues = {
    username: kind === 'create' && !USERNAME.test(username.trim()) ? t('users.usernameFormat') : undefined,
    password: needsPassword && (password.length < PASSWORD_MIN || password.length > 256) ? t('account.passwordLength', { min: PASSWORD_MIN }) : undefined,
  };
  const target = `${user.employeeCode} · ${user.fullName}`;
  const run = useMutation({
    mutationFn: () => {
      const version = user.version;
      if (kind === 'create') return api(`${USERS}/${user.id}/account`, { method: 'POST', body: JSON.stringify({ username: username.trim(), initialPassword: password, version }) });
      if (kind === 'reset') return api(`${USERS}/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify({ temporaryPassword: password, version }) });
      if (kind === 'unlock') return api(`${USERS}/${user.id}/unlock`, { method: 'POST', body: JSON.stringify({ version }) });
      return api(`${USERS}/${user.id}/account-status`, { method: 'PATCH', body: JSON.stringify({ isActive: kind === 'enable', version }) });
    },
    onSuccess: async () => {
      onClose();
      await onChanged();
      onResult({ success: true, title: t(`users.accountDone.${kind}`), message: target });
    },
    onError: error => {
      // A taken username stays next to its field; everything else closes the confirmation and explains (UI-15).
      if (error instanceof ApiError && error.code === 'USERNAME_TAKEN') return;
      onClose();
      onResult({ success: false, error, title: t(`users.accountFailed.${kind}`), message: target,
        hint: error instanceof ApiError && error.code === 'VERSION_CONFLICT' ? t('users.conflictHint') : undefined });
    },
  });
  const usernameError = (submitted ? issues.username : undefined) ?? (run.error instanceof ApiError && run.error.code === 'USERNAME_TAKEN' ? t('errors.USERNAME_TAKEN') : undefined);
  return (
    <FormDialog title={t(`users.accountConfirm.${kind}`)} description={target} submitLabel={t(`users.accountAction.${kind}`)}
      submitAction={kind === 'disable' ? 'void' : kind === 'create' ? 'add' : 'confirm'} dirty={Boolean(username || password)}
      pending={run.isPending} canSubmit error={null} onClose={onClose}
      onSubmit={() => { setSubmitted(true); if (!issues.username && !issues.password) run.mutate(); }}>
      <Stack spacing={2}>
        <Typography variant="body2">{t(`users.accountEffect.${kind}`)}</Typography>
        {kind === 'create' && <TextField size="small" required label={t('users.username')} value={username} disabled={run.isPending}
          error={Boolean(usernameError)} helperText={usernameError ?? t('users.usernameHint')} onChange={e => { setUsername(e.target.value); run.reset(); }} />}
        {needsPassword && <PasswordField size="small" autoComplete="new-password" label={t(kind === 'create' ? 'users.password' : 'users.temporaryPassword')}
          value={password} error={submitted ? issues.password : undefined} helper={t('users.initialPasswordHint', { min: PASSWORD_MIN })} onChange={setPassword} />}
      </Stack>
    </FormDialog>
  );
}

/** BA-USR-04, BA-N-06/07: deactivation disables the account and ends sessions; reactivation leaves the account as it is. */
export function EmploymentDialog({ user, onClose, onResult, onChanged }: {
  user: UserDetail; onClose: () => void; onResult: (result: ActionResult) => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const deactivating = user.employmentStatus === 'ACTIVE';
  const target = `${user.employeeCode} · ${user.fullName}`;
  const run = useMutation({
    mutationFn: () => api(`${USERS}/${user.id}/employment-status`, { method: 'PATCH',
      body: JSON.stringify({ status: deactivating ? 'INACTIVE' : 'ACTIVE', version: user.version }) }),
    onSuccess: async () => {
      onClose();
      await onChanged();
      onResult({ success: true, title: t(deactivating ? 'users.deactivated' : 'users.activated'), message: target,
        status: t(`users.employment.${deactivating ? 'INACTIVE' : 'ACTIVE'}`) });
    },
    onError: error => {
      onClose();
      onResult({ success: false, error, message: target, title: t(deactivating ? 'users.deactivateFailed' : 'users.activateFailed'),
        hint: error instanceof ApiError && error.code === 'VERSION_CONFLICT' ? t('users.conflictHint') : undefined });
    },
  });
  return (
    <FormDialog title={t(deactivating ? 'users.deactivateTitle' : 'users.activateTitle')} description={target}
      submitLabel={t(deactivating ? 'users.deactivate' : 'users.activate')} submitAction={deactivating ? 'void' : 'confirm'}
      pending={run.isPending} canSubmit error={null} onClose={onClose} onSubmit={() => run.mutate()}>
      <Stack spacing={1}>
        {(deactivating ? ['deactivateEffect', 'deactivateKeeps', 'deactivateBlocked'] : ['activateEffect', 'activateChecks']).map(key =>
          <Typography key={key} variant="body2" color={key.endsWith('Effect') ? undefined : 'text.secondary'}>
            {t(`users.${key}`, { account: t(`users.account.${user.accountStatus}`) })}
          </Typography>)}
      </Stack>
    </FormDialog>
  );
}
