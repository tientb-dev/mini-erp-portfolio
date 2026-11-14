/** PR, PO and GRR share one list/detail layout (DocListPage/DocDetailView); only the create form and a few header fields differ. */
import { DocConfig } from './types';
import { DocListPage, ReceiptStatusChip } from './DocListPage';
import { CreatePrDialog } from './CreatePrDialog';
import { CreatePoDialog } from './CreatePoDialog';
import { CreateGrrDialog } from './CreateGrrDialog';

const PR: DocConfig = {
  key: 'pr', perm: 'PR', path: 'purchase-requisitions', Create: CreatePrDialog,
  columns: (t) => [
    { field: 'salesContractNumber', headerName: t('gir.salesContract'), width: 160 },
    { field: 'customerName', headerName: t('sc.customer'), flex: 1, minWidth: 160 },
  ],
  fields: (d, t) => [[t('gir.salesContract'), `${String(d.salesContractNumber)}: ${String(d.customerName)}`], [t('pr.category'), t(`category.${String(d.category)}`)]],
};
const PO: DocConfig = {
  key: 'po', perm: 'PO', path: 'purchase-orders', Create: CreatePoDialog,
  columns: (t) => [
    { field: 'supplierName', headerName: t('po.supplier'), flex: 1, minWidth: 180 },
    { field: 'receiptStatus', headerName: t('po.receiptStatus'), width: 170, renderCell: (p) => <ReceiptStatusChip status={String(p.value)} /> },
  ],
  fields: (d, t) => [[t('po.supplier'), String(d.supplierName)], [t('po.receiptStatus'), <ReceiptStatusChip key="receipt" status={String(d.receiptStatus)} />]],
};
const GRR: DocConfig = {
  key: 'grr', perm: 'GRR', path: 'goods-receipt-requests', Create: CreateGrrDialog,
  columns: (t) => [
    { field: 'poNumber', headerName: t('gr.po'), width: 160 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 90 },
  ],
  fields: (d, t) => [[t('gr.po'), `${String(d.poNumber)}: ${String(d.supplierName)}`], [t('inventory.warehouse'), String(d.warehouseCode)]],
};

export const PurchaseRequisitionsPage = () => <DocListPage cfg={PR} />;
export const PurchaseOrdersPage = () => <DocListPage cfg={PO} />;
export const GoodsReceiptRequestsPage = () => <DocListPage cfg={GRR} />;
