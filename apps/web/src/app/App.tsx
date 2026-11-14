import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { themes } from '../config/theme';
import { Login } from '../features/identity';
import { token } from '../services/api-client';
import { AppShell } from './layouts/AppShell';

export function App() {
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const [loggedIn, setLoggedIn] = useState(Boolean(token.get()));
  const theme = i18n.language === 'en' ? themes.en : themes.vi;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {loggedIn ? <AppShell onLogout={() => { token.clear(); qc.clear(); setLoggedIn(false); }} /> : <Login onLoggedIn={() => setLoggedIn(true)} />}
    </ThemeProvider>
  );
}
