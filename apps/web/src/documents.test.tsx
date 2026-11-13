import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './i18n';
import { PurchaseOrdersPage } from './procurement';
import { SalesContractsPage } from './sales-contracts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

/** Routes fetch calls by path to canned JSON; records POST bodies. */
function mockApi(routes: Record<string, unknown>) {
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
      return new Response(JSON.stringify({ id: 99 }), { status: 201 });
    }
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : []), { status: 200 });
  });
  return posts;
}

const me = (permissions: string[]) => ({ id: 1, permissions, warehouseIds: [1] });

describe('Purchase order form', () => {
  it('blocks quantities above what the PR line still allows', async () => {
    const posts = mockApi({
      '/auth/me': me(['PO.VIEW', 'PO.CREATE']),
      '/suppliers': [{ id: 7, code: 'S1', name: 'Supplier 1' }],
      '/purchase-requisition-lines/available-for-po': [{ id: 5, prNumber: 'PR-2026-000001', partNumber: 'PN-1', productName: 'Switch', uom: 'PCS', quantity: '10', remaining: '4' }],
      '/purchase-orders': [],
    });
    wrap(<PurchaseOrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo đơn đặt mua' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Nhà cung cấp/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'S1: Supplier 1' }));
    const qty = await screen.findByLabelText('Số lượng');
    fireEvent.change(qty, { target: { value: '5' } });
    expect(screen.getByText('Tối đa 4')).toBeTruthy();
    const submit = screen.getAllByRole('button', { name: 'Tạo đơn đặt mua' }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(qty, { target: { value: '4' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toEqual([{ url: '/purchase-orders', body: { supplierId: 7, lines: [{ sourceLineId: 5, quantity: 4 }] } }]));
  });
});

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
