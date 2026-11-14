import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Stack } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { DataTable, ErrorAlert, PageHeader } from '../../shared/components';

export interface InventoryRow {
  id: number;
  warehouse: { code: string; name: string };
  product: { partNumber: string; name: string; uom: string };
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
}

export function InventoryPage() {
  const { t } = useTranslation();
  const inventory = useQuery({ queryKey: ['inventories'], queryFn: () => api<InventoryRow[]>('/inventories') });
  const qty = { type: 'number' as const, width: 130, valueGetter: (v: string) => Number(v) };
  const columns: GridColDef<InventoryRow>[] = [
    { field: 'warehouse', headerName: t('inventory.warehouse'), width: 110, valueGetter: (_v, r) => r.warehouse.code },
    { field: 'partNumber', headerName: t('product.partNumber'), width: 170, valueGetter: (_v, r) => r.product.partNumber },
    { field: 'name', headerName: t('product.name'), flex: 1, minWidth: 200, valueGetter: (_v, r) => r.product.name },
    { field: 'uom', headerName: t('product.uom'), width: 80, valueGetter: (_v, r) => r.product.uom },
    { field: 'onHandQuantity', headerName: t('inventory.onHand'), ...qty },
    { field: 'reservedQuantity', headerName: t('inventory.reserved'), ...qty },
    { field: 'availableQuantity', headerName: t('inventory.available'), ...qty, cellClassName: () => 'qty-available' },
  ];
  return (
    <>
      <PageHeader title={t('nav.inventory')} />
      <Stack spacing={2}>
        <ErrorAlert error={inventory.error} />
        <DataTable
          rows={inventory.data ?? []} columns={columns} loading={inventory.isLoading} emptyHint={t('inventory.empty')}
          sx={{ '& .qty-available': { fontWeight: 600 } }}
        />
      </Stack>
    </>
  );
}
