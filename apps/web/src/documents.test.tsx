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

/** Routes fetch calls by path to canned JSON; records POST/PATCH bodies. */
function mockApi(routes: Record<string, unknown>) {
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    if (init?.method === 'POST' || init?.method === 'PATCH') {
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

describe('Document editing (IM18)', () => {
  it('Sales edits a DRAFT contract in the create form; lines keep their ids and the version is sent', async () => {
    const draft = {
      id: 4, documentNumber: 'SC-2026-000002', status: 'DRAFT', version: 2, customerId: 8, customerCode: 'C1', customerName: 'Customer 1', createdBy: 2,
      createdByName: 'Sales', createdAt: '2026-11-13T00:00:00Z', pendingProposals: 0,
      lines: [{ id: 12, itemCode: 'SW', itemName: 'Switch', uomName: 'Cái', quantity: '10.000', products: [] }],
    };
    const posts = mockApi({
      '/auth/me': me(['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CREATE']), '/customers': [{ id: 8, code: 'C1', name: 'Customer 1' }],
      '/sales-contracts/4': draft, '/sales-contracts': [draft],
    });
    wrap(<SalesContractsPage />);
    fireEvent.click(await screen.findByText('SC-2026-000002'));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    const qty = await screen.findByLabelText(/Số lượng/);
    expect((qty as HTMLInputElement).value).toBe('10');
    fireEvent.change(qty, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(posts).toEqual([{
      url: '/sales-contracts/4',
      body: { version: 2, customerId: 8, lines: [{ id: 12, itemCode: 'SW', itemName: 'Switch', uomName: 'Cái', quantity: 12 }] },
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

  const rejectedPo = (createdBy: number) => ({
    id: 40, documentNumber: 'PO-2026-000007', approvalStatus: 'REJECTED', version: 3, createdBy, createdByName: 'Buyer', assignedApproverId: 9,
    assignedApproverName: 'Approver', createdAt: '2026-11-13T00:00:00Z', supplierId: 7, supplierName: 'Supplier 1', children: [], history: [],
    lines: [{ id: 31, sourceLineId: 5, ref: 'PR-2026-000001', partNumber: 'PN-1', productName: 'Switch', uom: 'PCS', quantity: '4.000' }],
  });

  it('Creator edits a REJECTED PO: form is prefilled, warns about resubmitting, PATCHes line ids + version', async () => {
    const posts = mockApi({
      '/auth/me': me(['PO.VIEW', 'PO.CREATE']), '/suppliers': [{ id: 7, code: 'S1', name: 'Supplier 1' }],
      '/purchase-requisition-lines/available-for-po': [{ id: 5, prNumber: 'PR-2026-000001', partNumber: 'PN-1', productName: 'Switch', uom: 'PCS', quantity: '10', remaining: '6' }],
      '/purchase-orders/40': rejectedPo(1), '/purchase-orders': [rejectedPo(1)],
    });
    wrap(<PurchaseOrdersPage />);
    fireEvent.click(await screen.findByText('PO-2026-000007'));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    expect(await screen.findByText(/cần Gửi duyệt lại/)).toBeTruthy();
    const qty = await screen.findByLabelText('Số lượng');
    await waitFor(() => expect((qty as HTMLInputElement).value).toBe('4'));
    fireEvent.change(qty, { target: { value: '7' } });
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // above the 6 still allowed on the PR line
    fireEvent.change(qty, { target: { value: '6' } });
    fireEvent.click(save);
    await waitFor(() => expect(posts).toEqual([{
      url: '/purchase-orders/40', body: { version: 3, supplierId: 7, lines: [{ id: 31, sourceLineId: 5, quantity: 6 }] },
    }]));
  });

  it('Only the creator sees the edit button (04 §1: approvers never edit)', async () => {
    mockApi({ '/auth/me': me(['PO.VIEW', 'PO.CREATE', 'PO.APPROVE']), '/purchase-orders/40': rejectedPo(2), '/purchase-orders': [rejectedPo(2)] });
    wrap(<PurchaseOrdersPage />);
    fireEvent.click(await screen.findByText('PO-2026-000007'));
    await screen.findByText(/^Buyer,/);
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
  });
});
