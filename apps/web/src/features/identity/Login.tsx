import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { api, token } from '../../services/api-client';
import { PasswordField } from './account';

/** Shown once above the form: why the user is back here (ended session, unconfirmed sign-out). */
export interface LoginNotice { severity: 'info' | 'warning'; message: string }

export function Login({ onLoggedIn, notice }: { onLoggedIn: () => void; notice?: LoginNotice }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      token.set(res.accessToken);
      onLoggedIn();
    } catch (error) {
      setFailed((error as { code?: string }).code === 'TOO_MANY_ATTEMPTS' ? t('login.tooMany') : t('login.failed'));
    }
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2 }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 3, width: '100%', maxWidth: 420, display: 'grid', gap: 2 }}>
        <div>
          <Typography component="p" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5 }}>{t('app.title')}</Typography>
          <Typography variant="h1">{t('login.title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('login.subtitle')}</Typography>
        </div>
        {notice && !failed && <Alert severity={notice.severity}>{notice.message}</Alert>}
        {failed && <Alert severity="error">{failed}</Alert>}
        <TextField label={t('login.username')} value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" />
        <PasswordField label={t('login.password')} value={password} onChange={setPassword} autoComplete="current-password" />
        <Button type="submit" variant="contained">{t('login.submit')}</Button>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>{t('login.forgot')}</Typography>
      </Paper>
    </Box>
  );
}
