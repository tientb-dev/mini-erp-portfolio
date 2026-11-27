import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { themes } from '../config/theme';
import { ForcePasswordChange, Login, LoginNotice, useMe } from '../features/identity';
import { api, PASSWORD_CHANGE_REQUIRED, SESSION_ENDED, token } from '../services/api-client';
import { ActionResult, ActionResultDialog } from '../shared/components/ActionResultDialog';
import { AppShell } from './layouts/AppShell';

/** How a signed-in period ended; decides what the Login page tells the user (F-OA1.2-09). */
type Ending = { kind: 'logout' } | { kind: 'logoutUnconfirmed' } | { kind: 'sessionInvalid' } | { kind: 'passwordChanged' };

/** Signed-in area: the ERP shell, or only the required password change while the backend demands it (BA-UI-07). */
function SignedIn({ onEnd }: { onEnd: (ending: Ending) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  useEffect(() => {
    const recheck = () => void qc.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener(PASSWORD_CHANGE_REQUIRED, recheck);
    return () => window.removeEventListener(PASSWORD_CHANGE_REQUIRED, recheck);
  }, [qc]);
  // The server revokes the session; if that cannot be confirmed the local sign-out still happens, and Login says so.
  const logout = () => void api('/auth/logout', { method: 'POST' })
    .then(() => onEnd({ kind: 'logout' }),
      // 401: the session was already gone on the server, so the sign-out is complete.
      (error: { status?: number }) => onEnd({ kind: error.status === 401 ? 'logout' : 'logoutUnconfirmed' }));
  const changed = () => onEnd({ kind: 'passwordChanged' });
  if (!me.data) return null;
  if (me.data.mustChangePassword) return <ForcePasswordChange me={me.data} onChanged={changed} onLogout={logout} />;
  return <AppShell onLogout={logout} onPasswordChanged={changed} />;
}

export function App() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [loggedIn, setLoggedIn] = useState(Boolean(token.get()));
  const [result, setResult] = useState<ActionResult>();
  const [loginNotice, setLoginNotice] = useState<LoginNotice>();
  const theme = i18n.language === 'en' ? themes.en : themes.vi;
  const end = useCallback((ending: Ending) => {
    token.clear();
    qc.clear(); // no business data of the old session survives into the next one
    setLoggedIn(false);
    setResult(ending.kind === 'passwordChanged' ? { success: true, title: t('account.changedTitle'), message: t('account.changedMessage') } : undefined);
    setLoginNotice(ending.kind === 'sessionInvalid' ? { severity: 'info', message: t('login.sessionInvalid') }
      : ending.kind === 'logoutUnconfirmed' ? { severity: 'warning', message: t('login.logoutUnconfirmed') } : undefined);
  }, [qc, t]);
  useEffect(() => {
    // api-client raises this once per token, so concurrent 401s produce one notice.
    const ended = () => end({ kind: 'sessionInvalid' });
    window.addEventListener(SESSION_ENDED, ended);
    return () => window.removeEventListener(SESSION_ENDED, ended);
  }, [end]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {loggedIn ? <SignedIn onEnd={end} />
        : <Login notice={loginNotice} onLoggedIn={() => { setLoginNotice(undefined); setLoggedIn(true); }} />}
      {result && <ActionResultDialog result={result} onClose={() => setResult(undefined)} />}
    </ThemeProvider>
  );
}
