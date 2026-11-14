import { ComponentType, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AppBar, Box, Button, CssBaseline, Drawer, IconButton, List, ListItemButton, ListItemText, ListSubheader, ThemeProvider, Toolbar, Typography,
  useMediaQuery,
} from '@mui/material';
import { token } from './api';
import { Login } from './Login';
import { GoodsIssueRequestsPage, GoodsIssuesPage } from './goods-issues';
import { GoodsReceiptsPage } from './goods-receipts';
import { CustomersPage, InventoryPage, ProductsPage, SuppliersPage, WarehousesPage } from './pages';
import { NavContext, useMe } from './doc-ui';
import { InventoryLotsPage } from './inventory-lots';
import { GoodsReceiptRequestsPage, PurchaseOrdersPage, PurchaseRequisitionsPage } from './procurement';
import { SalesContractsPage } from './sales-contracts';
import { themes, tokens } from './theme';

/** Each page with the permission needed to open it; the sidebar hides pages the user cannot view. */
const PAGES = {
  salesContracts: [SalesContractsPage, 'SALES_CONTRACT.VIEW'],
  purchaseRequisitions: [PurchaseRequisitionsPage, 'PR.VIEW'],
  purchaseOrders: [PurchaseOrdersPage, 'PO.VIEW'],
  goodsReceiptRequests: [GoodsReceiptRequestsPage, 'GRR.VIEW'],
  goodsReceipts: [GoodsReceiptsPage, 'GR.VIEW'],
  goodsIssueRequests: [GoodsIssueRequestsPage, 'GIR.VIEW'],
  goodsIssues: [GoodsIssuesPage, 'GI.VIEW'],
  inventory: [InventoryPage, 'INVENTORY.VIEW'],
  inventoryLots: [InventoryLotsPage, 'INVENTORY.VIEW'],
  products: [ProductsPage, 'PRODUCT.VIEW'],
  warehouses: [WarehousesPage, 'WAREHOUSE.VIEW'],
  customers: [CustomersPage, 'CUSTOMER.VIEW'],
  suppliers: [SuppliersPage, 'SUPPLIER.VIEW'],
} as const;
type PageKey = keyof typeof PAGES;

/** Sidebar groups follow business modules. */
const NAV: { group: string; items: PageKey[] }[] = [
  { group: 'nav.sales', items: ['salesContracts'] },
  { group: 'nav.purchasing', items: ['purchaseRequisitions', 'purchaseOrders'] },
  { group: 'nav.warehouseOps', items: ['goodsReceiptRequests', 'goodsReceipts', 'goodsIssueRequests', 'goodsIssues', 'inventory', 'inventoryLots'] },
  { group: 'nav.masterData', items: ['products', 'warehouses', 'customers', 'suppliers'] },
];

// shortcut: page state instead of React Router (no deep links/back button); add the router when URLs per document are needed.
export function App() {
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const [loggedIn, setLoggedIn] = useState(Boolean(token.get()));
  const theme = i18n.language === 'en' ? themes.en : themes.vi;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {loggedIn ? <Shell onLogout={() => { token.clear(); qc.clear(); setLoggedIn(false); }} /> : <Login onLoggedIn={() => setLoggedIn(true)} />}
    </ThemeProvider>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
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
