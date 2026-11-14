import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { SalesContractsPage } from '.';

describe('Sales contract product proposals', () => {
  const detail = {
    id: 3, documentNumber: 'SC-2026-000001', status: 'ACTIVE', customerCode: 'C1', customerName: 'Customer 1', createdBy: 2, createdByName: 'Sales',
    createdAt: '2026-11-13T00:00:00Z', pendingProposals: 1,
    lines: [{
      id: 11, itemCode: 'SW', itemName: 'Switch', uomName: 'Cái', quantity: '10',
      products: [{ id: 21, productId: 5, partNumber: 'PN-1', name: 'Switch 24', status: 'PENDING', reason: 'Thay thế', decisionNote: null, proposedByName: 'PM', decidedByName: null, decidedAt: null }],
    }],
  };

  async function openContract(permissions: string[]) {
    const posts = mockApi({ '/auth/me': me(permissions), '/sales-contracts/3': detail, '/sales-contracts': [detail] });
    wrap(<SalesContractsPage />);
    fireEvent.click(await screen.findByText('SC-2026-000001'));
    await screen.findByText('PN-1: Switch 24');
    return posts;
  }

  it('Sales sees confirm/reject on a pending proposal and confirms with a note', async () => {
    const posts = await openContract(['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CONFIRM_PRODUCT']);
    expect(screen.queryByRole('button', { name: 'Đề xuất mã hàng' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.change(await screen.findByLabelText('Ghi chú hoặc số phụ lục'), { target: { value: 'PL-01' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xác nhận' }).at(-1)!);
    await waitFor(() => expect(posts).toEqual([{ url: '/product-proposals/21/approve', body: { note: 'PL-01' } }]));
  });

  it('PM can propose but never confirm in place of Sales (04 §2)', async () => {
    await openContract(['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.PROPOSE_PRODUCT']);
    expect(screen.getByRole('button', { name: 'Đề xuất mã hàng' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  });
});

describe('Document editing (IM18)', () => {
  it('Sales edits a DRAFT contract in the create form; lines keep their ids and the version is sent', async () => {
    const draft = {
      id: 4, documentNumber: 'SC-2026-000002', status: 'DRAFT', version: 2, customerId: 8, customerCode: 'C1', customerName: 'Customer 1', createdBy: 2,
      createdByName: 'Sales', createdAt: '2026-11-13T00:00:00Z', pendingProposals: 0, responsibleSalesUserId: 2, responsibleSalesName: 'Sales A',
      lines: [{ id: 12, itemCode: 'SW', itemName: 'Switch', uomName: 'Cái', quantity: '10.000', products: [] }],
    };
    const posts = mockApi({
      '/auth/me': me(['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CREATE']), '/customers': [{ id: 8, code: 'C1', name: 'Customer 1' }],
      '/sales-contracts/4': draft, '/sales-contracts': [draft],
      '/sales-contracts/responsible-sales-candidates': [{ id: 2, fullName: 'Sales A' }, { id: 3, fullName: 'Sales B' }],
    });
    wrap(<SalesContractsPage />);
    fireEvent.click(await screen.findByText('SC-2026-000002'));
    expect(await screen.findByText('Sales A')).toBeTruthy(); // responsible sales shown on the detail
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    const qty = await screen.findByLabelText(/Số lượng/);
    expect((qty as HTMLInputElement).value).toBe('10');
    fireEvent.change(qty, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(posts).toEqual([{
      url: '/sales-contracts/4',
      body: { version: 2, customerId: 8, responsibleSalesUserId: 2, lines: [{ id: 12, itemCode: 'SW', itemName: 'Switch', uomName: 'Cái', quantity: 12 }] },
    }]));
  });

  it('An ACTIVE contract has no edit button', async () => {
    const active = { id: 5, documentNumber: 'SC-2026-000003', status: 'ACTIVE', version: 3, customerId: 8, customerCode: 'C1', customerName: 'C', createdBy: 2,
      createdByName: 'Sales', createdAt: '2026-11-13T00:00:00Z', pendingProposals: 0, lines: [] };
    mockApi({ '/auth/me': me(['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CREATE']), '/sales-contracts/5': active, '/sales-contracts': [active] });
    wrap(<SalesContractsPage />);
    fireEvent.click(await screen.findByText('SC-2026-000003'));
    await screen.findByText('Hợp đồng bán SC-2026-000003');
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
  });

});
