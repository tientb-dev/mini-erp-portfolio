import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { api, token } from './api';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      token.set(res.accessToken);
      onLoggedIn();
    } catch {
      setFailed(true);
    }
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2 }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 3, width: '100%', maxWidth: 360, display: 'grid', gap: 2 }}>
        <div>
          <Typography component="p" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5 }}>{t('app.title')}</Typography>
          <Typography variant="h1">{t('login.title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('login.subtitle')}</Typography>
        </div>
        {failed && <Alert severity="error">{t('login.failed')}</Alert>}
        <TextField label={t('login.username')} value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" />
        <TextField label={t('login.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        <Button type="submit" variant="contained">{t('login.submit')}</Button>
      </Paper>
    </Box>
  );
}
