import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Avatar, Box, Button, Dialog, DialogActions, DialogContent, Divider, IconButton, InputAdornment, ListItemIcon,
  ListItemText, Menu, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import Password from '@mui/icons-material/Password';
import Logout from '@mui/icons-material/Logout';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import { api, token } from '../../services/api-client';
import { ErrorAlert, FormDialog } from '../../shared/components';
import { DialogHeading } from '../../shared/components/DialogHeading';
import type { Me } from './api';

/** Same bounds as the API (BA-USR-05): 12–256 characters, no composition rule, passphrases welcome. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

interface PasswordInput { currentPassword: string; newPassword: string; confirm: string }
const empty: PasswordInput = { currentPassword: '', newPassword: '', confirm: '' };

function problems(v: PasswordInput) {
  return {
    newPassword: v.newPassword && (v.newPassword.length < PASSWORD_MIN || v.newPassword.length > PASSWORD_MAX) ? 'account.passwordLength'
      : v.newPassword && v.newPassword === v.currentPassword ? 'account.passwordSame' : undefined,
    confirm: v.confirm && v.confirm !== v.newPassword ? 'account.passwordMismatch' : undefined,
  };
}

/** Common password input with show/hide, shared by Login, the change dialog and the required-change screen. */
export function PasswordField({ label, value, onChange, error, helper, autoComplete, autoFocus, inputRef, onBlur, size, fullWidth }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; helper?: string; autoComplete: string; autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>; onBlur?: () => void; size?: "small" | "medium"; fullWidth?: boolean;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <TextField label={label} type={shown ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} required
      autoComplete={autoComplete} autoFocus={autoFocus} error={Boolean(error)} helperText={error ? t(error, { min: PASSWORD_MIN }) : helper}
      inputRef={inputRef} onBlur={onBlur} size={size} fullWidth={fullWidth}
      slotProps={{ htmlInput: { maxLength: PASSWORD_MAX }, input: { endAdornment: (
        <InputAdornment position="end">
          <IconButton edge="end" onClick={() => setShown(s => !s)} aria-label={t(shown ? 'account.hidePassword' : 'account.showPassword')}>
            {shown ? <VisibilityOff /> : <Visibility />}
          </IconButton>
        </InputAdornment>
      ) } }} />
  );
}

function usePasswordForm(onChanged: () => void) {
  const [value, setValue] = useState(empty);
  const issues = problems(value);
  const mutation = useMutation({
    mutationFn: async () => {
      await api<void>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: value.currentPassword, newPassword: value.newPassword }) });
      // Every session just ended on the server; drop the token at once so in-flight 401s are not reported as an expired session.
      token.clear();
    },
    onSuccess: onChanged,
  });
  const canSubmit = Boolean(value.currentPassword && value.newPassword && value.confirm) && !issues.newPassword && !issues.confirm;
  return { value, setValue, issues, mutation, canSubmit, dirty: value !== empty && Object.values(value).some(Boolean) };
}

function PasswordFields({ form }: { form: ReturnType<typeof usePasswordForm> }) {
  const { t } = useTranslation();
  const set = (k: keyof PasswordInput) => (v: string) => form.setValue(prev => ({ ...prev, [k]: v }));
  return (
    <>
      <PasswordField label={t('account.currentPassword')} value={form.value.currentPassword} onChange={set('currentPassword')} autoComplete="current-password" autoFocus />
      <PasswordField label={t('account.newPassword')} value={form.value.newPassword} onChange={set('newPassword')} autoComplete="new-password"
        error={form.issues.newPassword} helper={t('account.passwordHint', { min: PASSWORD_MIN })} />
      <PasswordField label={t('account.confirmPassword')} value={form.value.confirm} onChange={set('confirm')} autoComplete="new-password" error={form.issues.confirm} />
    </>
  );
}

/** Self-service change from the account menu. Success ends every session, so the caller returns to Login. */
export function ChangePasswordDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const form = usePasswordForm(onChanged);
  return (
    <FormDialog title={t('account.changePassword')} description={t('account.changeHint')} submitLabel={t('account.changePassword')}
      width={480} error={form.mutation.error} pending={form.mutation.isPending} canSubmit={form.canSubmit} dirty={form.dirty}
      onSubmit={() => form.mutation.mutate()} onClose={onClose}>
      <PasswordFields form={form} />
    </FormDialog>
  );
}

/** Required change (first sign-in, after an admin reset). Rendered instead of the ERP shell; the only ways out are change or sign out. */
export function ForcePasswordChange({ me, onChanged, onLogout }: { me: Me; onChanged: () => void; onLogout: () => void }) {
  const { t } = useTranslation();
  const form = usePasswordForm(onChanged);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form.canSubmit && !form.mutation.isPending) form.mutation.mutate();
  };
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2 }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 3, width: '100%', maxWidth: 420, display: 'grid', gap: 2 }}>
        <div>
          <Typography component="p" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5 }}>{t('app.title')}</Typography>
          <Typography variant="h1">{t('account.forceTitle')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('account.forceHint', { name: me.fullName ?? me.username })}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t('account.changeHint')}</Typography>
        </div>
        <ErrorAlert error={form.mutation.error} />
        <PasswordFields form={form} />
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button variant="outlined" onClick={onLogout} disabled={form.mutation.isPending}>{t('app.logout')}</Button>
          <Button type="submit" variant="contained" disabled={!form.canSubmit || form.mutation.isPending}>{t('account.changePassword')}</Button>
        </Stack>
      </Paper>
    </Box>
  );
}

/** First letters of the first and last words: 'Nguyễn Văn An' → 'NA'. */
const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? [words[0]!, words.at(-1)!] : words).map(w => w[0]!.toUpperCase()).join('') || '?';
};

function ProfileDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t('account.fullName'), me.fullName ?? ''], [t('login.username'), me.username ?? ''], [t('account.roles'), (me.roleCodes ?? []).join(', ') || '—'],
  ];
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="profile-title">
      <DialogHeading id="profile-title" onClose={onClose}>{t('account.profile')}</DialogHeading>
      <DialogContent>
        <Stack spacing={1.5}>
          {rows.map(([label, value]) => (
            <div key={label}>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography>{value}</Typography>
            </div>
          ))}
          <Typography variant="body2" color="text.secondary">{t('account.profileLater')}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>{t('common.close')}</Button></DialogActions>
    </Dialog>
  );
}

/** AppShell account menu: avatar initials, name, username; Profile, Change password, Sign out. */
export function AccountMenu({ me, onLogout, onPasswordChanged }: { me: Me; onLogout: () => void; onPasswordChanged: () => void }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<'profile' | 'password' | null>(null);
  const name = me.fullName || me.username || '';
  const pick = (next: 'profile' | 'password') => { setAnchor(null); setOpen(next); };
  return (
    <>
      <Button onClick={e => setAnchor(e.currentTarget)} aria-haspopup="menu" aria-label={t('account.menu')} sx={{ textTransform: 'none', gap: 1, px: 1 }}>
        <Avatar sx={{ width: 28, height: 28, fontSize: '0.8rem', bgcolor: 'primary.main' }}>{initials(name)}</Avatar>
        <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'left', lineHeight: 1.2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{name}</Typography>
          <Typography variant="caption" color="text.secondary">{me.username}</Typography>
        </Box>
        <KeyboardArrowDown fontSize="small" sx={{ color: 'text.secondary' }} />
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => pick('profile')}><ListItemIcon><PersonOutlined fontSize="small" /></ListItemIcon><ListItemText>{t('account.profile')}</ListItemText></MenuItem>
        <MenuItem onClick={() => pick('password')}><ListItemIcon><Password fontSize="small" /></ListItemIcon><ListItemText>{t('account.changePassword')}</ListItemText></MenuItem>
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); onLogout(); }}><ListItemIcon><Logout fontSize="small" /></ListItemIcon><ListItemText>{t('app.logout')}</ListItemText></MenuItem>
      </Menu>
      {open === 'profile' && <ProfileDialog me={me} onClose={() => setOpen(null)} />}
      {open === 'password' && <ChangePasswordDialog onClose={() => setOpen(null)} onChanged={onPasswordChanged} />}
    </>
  );
}
