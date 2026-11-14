import { ComponentType, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppBar, Box, Button, Drawer, IconButton, List, ListItemButton, ListItemText, ListSubheader, Toolbar, Typography, useMediaQuery } from '@mui/material';
import { tokens } from '../../config/theme';
import { useMe } from '../../features/identity';
import { NavContext } from '../../shared/navigation';
import { NAV, PageKey, PAGES } from '../routes';

// shortcut: page state instead of React Router (no deep links/back button); add the router when URLs per document are needed.

export function AppShell({ onLogout }: { onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const allowed = (k: PageKey) => Boolean(me.data?.permissions.includes(PAGES[k][1]));
  const [chosen, setPage] = useState<PageKey | null>(null);
  const [target, setTarget] = useState<{ page: PageKey; id: number; n: number } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktop = useMediaQuery('(min-width:900px)');
  const page = chosen ?? NAV.flatMap((g) => g.items).find(allowed) ?? null;
  // Pages that open a document directly read `initialId`; the others ignore it.
  const Page = page ? (PAGES[page][0] as ComponentType<{ initialId?: number }>) : null;
  const openDoc = (p: string, id: number) => { setPage(p as PageKey); setTarget({ page: p as PageKey, id, n: Date.now() }); };

  const nav = (
    <Box component="nav" aria-label={t('nav.label')} sx={{ width: tokens.sidebarWidth, pt: 1 }}>
      {NAV.map(({ group, items }) => items.some(allowed) && (
        <List key={group} dense subheader={<ListSubheader sx={{ bgcolor: 'transparent', lineHeight: 2.5 }}>{t(group)}</ListSubheader>}>
          {items.filter(allowed).map((k) => (
            <ListItemButton
              key={k}
              selected={k === page}
              onClick={() => { setPage(k); setMobileOpen(false); }}
              sx={{ mx: 1, borderRadius: 1, '&.Mui-selected': { color: 'primary.main', fontWeight: 600 } }}
            >
              <ListItemText primary={t(`nav.${k}`)} slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
            </ListItemButton>
          ))}
        </List>
      ))}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" color="inherit" sx={{ zIndex: (th) => th.zIndex.drawer + 1 }}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          {!desktop && (
            <IconButton edge="start" aria-label={t('nav.open')} onClick={() => setMobileOpen(true)}>
              <Box component="span" aria-hidden sx={{ fontSize: 20, lineHeight: 1 }}>☰</Box>
            </IconButton>
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
        {nav}
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, px: { xs: 2, md: 3 }, py: 3 }}>
        <Toolbar variant="dense" />
        <NavContext.Provider value={openDoc}>
          {Page && (target?.page === page ? <Page key={`${page}-${target.n}`} initialId={target.id} /> : <Page key={page} />)}
        </NavContext.Provider>
      </Box>
    </Box>
  );
}
