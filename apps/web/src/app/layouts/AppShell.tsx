import { useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppBar, Box, Button, Drawer, IconButton, Toolbar, Typography, useMediaQuery } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { tokens } from '../../config/theme';
import { useMe } from '../../features/identity';
import { NavContext, pagePath } from '../../shared/navigation';
import { NAV, PageKey, PAGES } from '../routes';
import { SideNav } from './SideNav';

const pageOf = (path?: string) => (Object.keys(PAGES) as PageKey[]).find((k) => pagePath(k) === `/${path}`) ?? null;

/** `/:page/:id?` → that page (with `initialId`) when the user may view it; anything else shows "not found". */
function PageRoute({ allowed }: { allowed: (k: PageKey) => boolean }) {
  const { t } = useTranslation();
  const { page: path, id } = useParams();
  const page = pageOf(path);
  if (!page || !allowed(page)) return <Typography color="text.secondary">{t('common.notFound')}</Typography>;
  const Page = PAGES[page][0];
  return <Page key={`${page}-${id ?? ''}`} initialId={id ? Number(id) : undefined} />;
}

export function AppShell({ onLogout }: { onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const active = pageOf(useLocation().pathname.split('/')[1]);
  const allowed = (k: PageKey) => Boolean(me.data?.permissions.includes(PAGES[k][1]));
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktop = useMediaQuery('(min-width:900px)');
  const first = NAV.flatMap((g) => g.items).find(allowed);
  const openDoc = (p: string, id: number) => navigate(pagePath(p, id));

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" color="inherit" sx={{ zIndex: (th) => th.zIndex.drawer + 1 }}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          {!desktop && (
            <IconButton edge="start" aria-label={t('nav.open')} onClick={() => setMobileOpen(true)}><MenuIcon /></IconButton>
          )}
          <Typography component="span" sx={{ fontWeight: 700, color: 'primary.main', flexGrow: 1 }}>{t('app.title')}</Typography>
          <Button size="small" onClick={() => void i18n.changeLanguage(i18n.language === 'en' ? 'vi' : 'en')}>{t('app.language')}</Button>
          <Button size="small" onClick={onLogout}>{t('app.logout')}</Button>
        </Toolbar>
      </AppBar>
      <Drawer
        variant={desktop ? 'permanent' : 'temporary'}
        open={desktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ width: desktop ? tokens.sidebarWidth : 0, flexShrink: 0 }}
      >
        <Toolbar variant="dense" />
        <SideNav active={active} allowed={allowed} onNavigate={() => setMobileOpen(false)} />
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, px: { xs: 2, md: 3 }, py: 3 }}>
        <Toolbar variant="dense" />
        <NavContext.Provider value={openDoc}>
          {me.data && (
            <Routes>
              <Route path="/" element={first ? <Navigate to={pagePath(first)} replace /> : null} />
              <Route path="/:page/:id?" element={<PageRoute allowed={allowed} />} />
              <Route path="*" element={<Typography color="text.secondary">{t('common.notFound')}</Typography>} />
            </Routes>
          )}
        </NavContext.Provider>
      </Box>
    </Box>
  );
}
