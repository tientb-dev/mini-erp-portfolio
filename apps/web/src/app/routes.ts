import { ComponentType } from 'react';
import { SvgIconComponent } from '@mui/icons-material';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import MoveToInboxOutlined from '@mui/icons-material/MoveToInboxOutlined';
import OutboxOutlined from '@mui/icons-material/OutboxOutlined';
import PlaylistAddCheckOutlined from '@mui/icons-material/PlaylistAddCheckOutlined';
import PlaylistAddOutlined from '@mui/icons-material/PlaylistAddOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import TimelineOutlined from '@mui/icons-material/TimelineOutlined';
import WarehouseOutlined from '@mui/icons-material/WarehouseOutlined';
import WorkOutline from '@mui/icons-material/WorkOutlined';
import { JobTitlesPage, RolesPage } from '../features/administration';
import { GoodsReceiptsPage } from '../features/inbound';
import { InventoryLotsPage, InventoryPage } from '../features/inventory';
import { BrandsPage, CurrenciesPage, CustomersPage, DossierTypesPage, ProductsPage, SuppliersPage, TaxRatesPage, TemporaryProductsPage, UnitsOfMeasurePage, WarehousesPage } from '../features/master-data';
import { GoodsIssueRequestsPage, GoodsIssuesPage } from '../features/outbound';
import { GoodsReceiptRequestsPage, PurchaseOrdersPage, PurchaseRequisitionsPage } from '../features/procurement';
import { DossierConfigurationsPage } from '../features/document-dossier';
import { SalesContractsPage } from '../features/sales-contracts';

/**
 * Each page with the permission needed to open it and its sidebar icon; the sidebar hides pages the user cannot view.
 * URL: `/<kebab-key>` and `/<kebab-key>/<id>` (pagePath); the page gets the id as `initialId`.
 */
export const PAGES = {
  salesContracts: [SalesContractsPage, 'SALES_CONTRACT.VIEW', DescriptionOutlined],
  purchaseRequisitions: [PurchaseRequisitionsPage, 'PR.VIEW', PlaylistAddOutlined],
  purchaseOrders: [PurchaseOrdersPage, 'PO.VIEW', ReceiptLongOutlined],
  goodsReceiptRequests: [GoodsReceiptRequestsPage, 'GRR.VIEW', AssignmentOutlined],
  goodsReceipts: [GoodsReceiptsPage, 'GR.VIEW', MoveToInboxOutlined],
  goodsIssueRequests: [GoodsIssueRequestsPage, 'GIR.VIEW', PlaylistAddCheckOutlined],
  goodsIssues: [GoodsIssuesPage, 'GI.VIEW', OutboxOutlined],
  inventory: [InventoryPage, 'INVENTORY.VIEW', Inventory2Outlined],
  inventoryLots: [InventoryLotsPage, 'INVENTORY.VIEW', TimelineOutlined],
  products: [ProductsPage, 'PRODUCT.VIEW', CategoryOutlined],
  temporaryProducts: [TemporaryProductsPage, 'PRODUCT.VIEW', CategoryOutlined],
  brands: [BrandsPage, 'PRODUCT.VIEW', StorefrontOutlined],
  unitsOfMeasure: [UnitsOfMeasurePage, 'PRODUCT.VIEW', CategoryOutlined],
  currencies: [CurrenciesPage, 'PRODUCT.VIEW', ReceiptLongOutlined],
  dossierTypes: [DossierTypesPage, 'DOSSIER_TYPE.VIEW', FolderOutlined],
  dossierConfigurations: [DossierConfigurationsPage, 'DOSSIER_CONFIG.MANAGE', FolderOutlined],
  taxRates: [TaxRatesPage, 'PRODUCT.VIEW', ReceiptLongOutlined],
  warehouses: [WarehousesPage, 'WAREHOUSE.VIEW', WarehouseOutlined],
  customers: [CustomersPage, 'CUSTOMER.VIEW', GroupsOutlined],
  suppliers: [SuppliersPage, 'SUPPLIER.VIEW', LocalShippingOutlined],
  jobTitles: [JobTitlesPage, 'ORGANIZATION.VIEW', BadgeOutlined],
  roles: [RolesPage, 'ROLE.VIEW', AdminPanelSettingsOutlined],
} as const satisfies Record<string, readonly [ComponentType<{ initialId?: number }>, string, SvgIconComponent]>;

export type PageKey = keyof typeof PAGES;

export const PAGE_CREATE: Partial<Record<PageKey, string>> = {
  purchaseRequisitions: 'PR.CREATE', products: 'PRODUCT.CREATE', temporaryProducts: 'PROCUREMENT_CATALOG.MANAGE',
  brands: 'PROCUREMENT_CATALOG.MANAGE', unitsOfMeasure: 'UOM.MANAGE', warehouses: 'WAREHOUSE.CREATE',
  customers: 'CUSTOMER.CREATE', suppliers: 'SUPPLIER.CREATE', currencies: 'PROCUREMENT_CATALOG.MANAGE',
  taxRates: 'PROCUREMENT_CATALOG.MANAGE', dossierTypes: 'DOSSIER_TYPE.MANAGE', roles: 'ROLE.MANAGE', jobTitles: 'ORGANIZATION.MANAGE',
};

/**
 * A document URL (`/<page>/<id>`) a user without the page's VIEW may still open; the API applies the narrower scope
 * (ADR-0014: the responsible sales reads the PRs of their contracts). The list page stays hidden.
 */
export const DETAIL_ALSO: Partial<Record<PageKey, string>> = { purchaseRequisitions: 'SALES_CONTRACT.VIEW' };

/** Sidebar groups (parent → children) follow business modules. */
export const NAV: { group: string; icon: SvgIconComponent; items: PageKey[] }[] = [
  { group: 'nav.sales', icon: WorkOutline, items: ['salesContracts'] },
  { group: 'nav.purchasing', icon: ShoppingCartOutlined, items: ['purchaseRequisitions', 'purchaseOrders'] },
  { group: 'nav.warehouseOps', icon: StorefrontOutlined, items: ['goodsReceiptRequests', 'goodsReceipts', 'goodsIssueRequests', 'goodsIssues', 'inventory', 'inventoryLots'] },
  { group: 'nav.masterData', icon: FolderOutlined, items: ['products', 'temporaryProducts', 'brands', 'unitsOfMeasure', 'warehouses', 'customers', 'suppliers', 'currencies', 'taxRates', 'dossierTypes'] },
  { group: 'nav.system', icon: FolderOutlined, items: ['jobTitles', 'roles', 'dossierConfigurations'] },
];
