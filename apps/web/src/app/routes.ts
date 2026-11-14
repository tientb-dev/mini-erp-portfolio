import { GoodsReceiptsPage } from '../features/inbound';
import { InventoryLotsPage, InventoryPage } from '../features/inventory';
import { CustomersPage, ProductsPage, SuppliersPage, WarehousesPage } from '../features/master-data';
import { GoodsIssueRequestsPage, GoodsIssuesPage } from '../features/outbound';
import { GoodsReceiptRequestsPage, PurchaseOrdersPage, PurchaseRequisitionsPage } from '../features/procurement';
import { SalesContractsPage } from '../features/sales-contracts';

/** Each page with the permission needed to open it; the sidebar hides pages the user cannot view. */
export const PAGES = {
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
export type PageKey = keyof typeof PAGES;

/** Sidebar groups follow business modules. */
export const NAV: { group: string; items: PageKey[] }[] = [
  { group: 'nav.sales', items: ['salesContracts'] },
  { group: 'nav.purchasing', items: ['purchaseRequisitions', 'purchaseOrders'] },
  { group: 'nav.warehouseOps', items: ['goodsReceiptRequests', 'goodsReceipts', 'goodsIssueRequests', 'goodsIssues', 'inventory', 'inventoryLots'] },
  { group: 'nav.masterData', items: ['products', 'warehouses', 'customers', 'suppliers'] },
];
