import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { NavContext } from '../../shared/navigation';
import { InventoryLotsPage } from '.';

describe('Lot traceability (UAT-2, C71)', () => {
  const lot = (id: number, over: object) => ({
    id, warehouseId: 1, warehouseCode: 'HCM', productId: 5, partNumber: 'SW-24P', productName: 'Switch', isSerialTracked: false,
    sourceSalesContractId: 11, sourceSalesContractNumber: 'SC-2026-000011', ownerUserId: 3, ownerName: 'Sales A',
    goodsReceiptId: 21, goodsReceiptNumber: 'GR-2026-000021', approvedAt: '2026-11-14T00:00:00Z',
    receivedQuantity: '6', onHandQuantity: '4', reservedQuantity: '1', availableQuantity: '3', serialsInStock: null, serialsReserved: null, serialsIssued: null, ...over,
  });
  const lots = [
    lot(1, {}),
    lot(2, { sourceSalesContractId: 12, sourceSalesContractNumber: 'SC-2026-000012', ownerUserId: 4, ownerName: 'Sales B', goodsReceiptId: 22, goodsReceiptNumber: 'GR-2026-000022',
      productId: 6, partNumber: 'RT-AX', productName: 'Router', isSerialTracked: true, receivedQuantity: '3', onHandQuantity: '2', reservedQuantity: '1', availableQuantity: '1',
      serialsInStock: 1, serialsReserved: 1, serialsIssued: 1 }),
  ];

  it('shows provenance, quantities and serial states, filters by source contract, and links documents only with permission', async () => {
    mockApi({ '/auth/me': me(['INVENTORY.VIEW', 'GR.VIEW']), '/inventories/lots': lots });
    const openDoc = vi.fn();
    wrap(<NavContext.Provider value={openDoc}><InventoryLotsPage /></NavContext.Provider>);
    expect(await screen.findByText('Sales B')).toBeTruthy();
    expect(screen.getByText('1 / 1 / 1')).toBeTruthy(); // serials in stock / reserved / issued
    const row1 = screen.getAllByRole('row').find((r) => r.textContent?.includes('GR-2026-000021'))!;
    expect([...row1.querySelectorAll('[role=gridcell]')].map((c) => c.textContent).slice(7, 11)).toEqual(['6', '4', '1', '3']); // received, on hand, reserved, available
    // No SALES_CONTRACT.VIEW: the source contract is plain text; GR.VIEW: the GR is a link.
    expect(screen.queryByRole('button', { name: 'SC-2026-000011' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'GR-2026-000022' }));
    expect(openDoc).toHaveBeenCalledWith('goodsReceipts', 22);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'HĐ nguồn' }));
    fireEvent.click(await screen.findByRole('option', { name: 'SC-2026-000011' }));
    await waitFor(() => expect(screen.queryByText('Sales B')).toBeNull());
    expect(screen.getAllByText('Sales A').length).toBeGreaterThan(0);
  });

  it('links the source contract when the user may view contracts, and never links the GR without GR.VIEW', async () => {
    mockApi({ '/auth/me': me(['INVENTORY.VIEW', 'SALES_CONTRACT.VIEW']), '/inventories/lots': [lots[0]] });
    const openDoc = vi.fn();
    wrap(<NavContext.Provider value={openDoc}><InventoryLotsPage /></NavContext.Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'SC-2026-000011' }));
    expect(openDoc).toHaveBeenCalledWith('salesContracts', 11);
    expect(screen.queryByRole('button', { name: 'GR-2026-000021' })).toBeNull();
  });
});
