import { useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppBar, Box, Button, Drawer, IconButton, Toolbar, Typography, useMediaQuery } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { fillMedia, tokens } from '../../config/theme';
import { DossierConfigurationRoute } from '../../features/document-dossier/DossierConfigurationPage';
import { PrNotifications } from '../../features/procurement';
import { useMe } from '../../features/identity';
import { NavContext, pagePath } from '../../shared/navigation';
import { DETAIL_ALSO, NAV, PAGE_CREATE, PageKey, PAGES } from '../routes';
import { SideNav } from './SideNav';

const pageOf = (path?: string) => (Object.keys(PAGES) as PageKey[]).find((k) => pagePath(k) === `/${path}`) ?? null;

/** `/:page/:id?` → that page (with `initialId`) when the user may view it; anything else shows "not found". */
function PageRoute({ allowed, has }: { allowed: (k: PageKey) => boolean; has: (p: string) => boolean }) {
  const { t } = useTranslation();
  const { page: path, id } = useParams();
  const page = pageOf(path);
  const viaDetail = Boolean(page && id && DETAIL_ALSO[page] && has(DETAIL_ALSO[page]!));
  if (!page || !(allowed(page) || viaDetail)) return <Typography color="text.secondary">{t('common.notFound')}</Typography>;
  const creating = id === 'new' && PAGE_CREATE[page] && has(PAGE_CREATE[page]);
  if (id && !creating && !/^[1-9]\d*$/.test(id)) return <Typography color="text.secondary">{t('common.notFound')}</Typography>;
  const Page = PAGES[page][0];
  return <Page key={`${page}-${id ?? ''}`} initialId={creating ? 0 : id ? Number(id) : undefined} />;
}

export function AppShell({ onLogout }: { onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const active = pageOf(useLocation().pathname.split('/')[1]);
  const allowed = (k: PageKey) => Boolean(me.data?.permissions.includes(PAGES[k][1])
    || (k === 'purchaseRequisitions' && me.data?.permissions.some(permission => ['PR.CREATE', 'PR.APPROVE', 'PR.RECEIVE'].includes(permission))));
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktop = useMediaQuery('(min-width:900px)');
  const first = NAV.flatMap((g) => g.items).find(allowed);
  const openDoc = (p: string, id: number) => navigate(pagePath(p, id));

  return (
    // The shell fills the viewport exactly: the document never scrolls; the sidebar and the main area scroll on their own.
    <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <AppBar position="fixed" color="inherit" sx={{ zIndex: (th) => th.zIndex.drawer + 1 }}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          {!desktop && (
            <IconButton edge="start" aria-label={t('nav.open')} onClick={() => setMobileOpen(true)}><MenuIcon /></IconButton>
          )}
          <Typography component="span" sx={{ fontWeight: 700, color: 'primary.main', flexGrow: 1 }}>{t('app.title')}</Typography>
          <Button size="small" onClick={() => void i18n.changeLanguage(i18n.language === 'en' ? 'vi' : 'en')}>{t('app.language')}</Button>
          {me.data && <PrNotifications userId={me.data.id} openPr={id => openDoc("purchase-requisitions", id)} />}
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
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Toolbar variant="dense" sx={{ flexShrink: 0 }} />
        {/* The only vertical scroller for page content; DetailPageLayout's footer sticks to its bottom edge. */}
        <Box data-main-scroll sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* A fill page is held to the main area's height so its own data region scrolls instead (see fillMedia). */}
          <Box sx={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', minWidth: 0, px: { xs: 2, md: 3 }, py: 3, [fillMedia]: { '&:has([data-fill-page])': { flex: '1 1 0', minHeight: 0 } } }}>
            <NavContext.Provider value={openDoc}>
              {me.data && (
                <Routes>
                  <Route path="/" element={first ? <Navigate to={pagePath(first)} replace /> : null} />
                  <Route path="/dossier-configurations/:documentType" element={allowed('dossierConfigurations')
                    ? <DossierConfigurationRoute /> : <Typography color="text.secondary">{t('common.notFound')}</Typography>} />
                  <Route path="/:page/:id?" element={<PageRoute allowed={allowed} has={(p) => Boolean(me.data?.permissions.includes(p))} />} />
                  <Route path="*" element={<Typography color="text.secondary">{t('common.notFound')}</Typography>} />
                </Routes>
              )}
            </NavContext.Provider>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
