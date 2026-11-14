import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, MenuItem, Stack, TextField } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { useMe } from '../identity';
import { NavContext } from '../../shared/navigation';
import { fmtDate } from '../../shared/utils/format';
import { DataTable, ErrorAlert, PageHeader } from '../../shared/components';

export interface LotRow {
  id: number; warehouseId: number; warehouseCode: string; productId: number; partNumber: string; productName: string; isSerialTracked: boolean;
  sourceSalesContractId: number; sourceSalesContractNumber: string; ownerUserId: number; ownerName: string;
  goodsReceiptId: number; goodsReceiptNumber: string; approvedAt: string;
  receivedQuantity: string; onHandQuantity: string; reservedQuantity: string; availableQuantity: string;
  serialsInStock: number | null; serialsReserved: number | null; serialsIssued: number | null;
}

const FILTERS = ['warehouseId', 'productId', 'sourceSalesContractId', 'ownerUserId', 'goodsReceiptId'] as const;
type Filter = (typeof FILTERS)[number];
/** Label of each filter value, taken from the rows themselves (only what the user may see). */
const label: Record<Filter, (r: LotRow) => string> = {
  warehouseId: (r) => r.warehouseCode,
  productId: (r) => `${r.partNumber}: ${r.productName}`,
  sourceSalesContractId: (r) => r.sourceSalesContractNumber,
  ownerUserId: (r) => r.ownerName,
  goodsReceiptId: (r) => r.goodsReceiptNumber,
};

/**
 * Lot traceability (C71, read only): one row per inventory lot of the warehouses the user may view (the API filters them).
 * Links open the source HĐ / GR only when the user may view that document type; the target page checks again.
 */
export function InventoryLotsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const open = useContext(NavContext);
  const lots = useQuery({ queryKey: ['inventory-lots'], queryFn: () => api<LotRow[]>('/inventories/lots') });
  const [filter, setFilter] = useState<Partial<Record<Filter, string>>>({});
  const can = (p: string) => Boolean(me.data?.permissions.includes(p));
  const rows = (lots.data ?? []).filter((r) => FILTERS.every((f) => !filter[f] || String(r[f]) === filter[f]));
  const qty = { type: 'number' as const, width: 110, valueGetter: (v: string) => Number(v) };
  const columns: GridColDef<LotRow>[] = [
    { field: 'partNumber', headerName: t('product.partNumber'), width: 140 },
    { field: 'productName', headerName: t('product.name'), flex: 1, minWidth: 160 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 90 },
    {
      field: 'sourceSalesContractNumber', headerName: t('lots.sourceContract'), width: 160,
      renderCell: (p) => (can('SALES_CONTRACT.VIEW')
        ? <Link component="button" onClick={() => open('salesContracts', p.row.sourceSalesContractId)}>{p.value}</Link> : p.value),
    },
    { field: 'ownerName', headerName: t('lots.sourceSales'), width: 160 },
    {
      field: 'goodsReceiptNumber', headerName: t('lots.goodsReceipt'), width: 160,
      renderCell: (p) => (can('GR.VIEW') ? <Link component="button" onClick={() => open('goodsReceipts', p.row.goodsReceiptId)}>{p.value}</Link> : p.value),
    },
    { field: 'approvedAt', headerName: t('lots.approvedAt'), width: 170, valueFormatter: fmtDate },
    { field: 'receivedQuantity', headerName: t('lots.received'), ...qty },
    { field: 'onHandQuantity', headerName: t('inventory.onHand'), ...qty },
    { field: 'reservedQuantity', headerName: t('inventory.reserved'), ...qty },
    { field: 'availableQuantity', headerName: t('inventory.available'), ...qty, cellClassName: () => 'qty-available' },
    {
      field: 'serialsInStock', headerName: t('lots.serials'), width: 220, sortable: false,
      valueGetter: (_v, r) => (r.isSerialTracked ? t('lots.serialStates', { inStock: r.serialsInStock, reserved: r.serialsReserved, issued: r.serialsIssued }) : '—'),
    },
  ];
  const options = (f: Filter) => [...new Map((lots.data ?? []).map((r) => [String(r[f]), label[f](r)])).entries()];
  return (
    <>
      <PageHeader title={t('nav.inventoryLots')} />
      <Stack spacing={2}>
        <ErrorAlert error={lots.error} />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          {FILTERS.map((f) => (
            <TextField key={f} select size="small" label={t(`lots.filter.${f}`)} value={filter[f] ?? ''} sx={{ minWidth: 170 }}
              onChange={(e) => setFilter({ ...filter, [f]: e.target.value || undefined })}>
              <MenuItem value="">{t('lots.all')}</MenuItem>
              {options(f).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </TextField>
          ))}
        </Stack>
        <DataTable rows={rows} columns={columns} loading={lots.isLoading} emptyHint={t('lots.empty')} sx={{ '& .qty-available': { fontWeight: 600 } }} />
      </Stack>
    </>
  );
}
