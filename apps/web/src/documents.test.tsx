import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './i18n';
import { GoodsIssueRequestsPage } from './goods-issues';
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

describe('PO receipt status (C68–C68b)', () => {
  it('shows the receipt status in the list and detail, and received quantity per line', async () => {
    const po = {
      id: 41, documentNumber: 'PO-2026-000008', approvalStatus: 'APPROVED', version: 2, createdBy: 1, createdByName: 'Buyer', assignedApproverId: 9,
      assignedApproverName: 'Approver', createdAt: '2026-11-13T00:00:00Z', supplierId: 7, supplierName: 'Supplier 1', receiptStatus: 'PARTIALLY_RECEIVED',
      children: [], history: [],
      lines: [{ id: 32, sourceLineId: 5, ref: 'PR-2026-000001', partNumber: 'PN-1', productName: 'Switch', uom: 'PCS', quantity: '10.000', receivedQuantity: '4.000' }],
    };
    mockApi({ '/auth/me': me(['PO.VIEW']), '/purchase-orders/41': po, '/purchase-orders': [po] });
    wrap(<PurchaseOrdersPage />);
    expect(await screen.findByText('Nhập kho một phần')).toBeTruthy();
    fireEvent.click(screen.getByText('PO-2026-000008'));
    expect(await screen.findByText('Tình trạng nhập kho')).toBeTruthy();
    expect(await screen.findByRole('columnheader', { name: 'Đã nhập kho' })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: '4' })).toBeTruthy();
  });
});

describe('GIR A/C form (PR code #5)', () => {
  it('picks lines of PO-done PRs of the chosen kind and posts PR line ids only', async () => {
    const posts = mockApi({
      '/auth/me': me(['GIR.VIEW', 'GIR.CREATE']),
      '/sales-contracts/3/gir-pr-lines': [
        { id: 51, purchaseRequisitionId: 9, prNumber: 'PR-2026-000009', category: 'SALES_GOODS', partNumber: 'PN-1', productName: 'Switch', uom: 'PCS', quantity: '5', receivedQuantity: '2', remainingQuantity: 4 },
        { id: 52, purchaseRequisitionId: 10, prNumber: 'PR-2026-000010', category: 'MATERIAL', partNumber: 'CB-1', productName: 'Cable', uom: 'PCS', quantity: '8', receivedQuantity: '0', remainingQuantity: 8 },
      ],
      '/sales-contracts': [{ id: 3, documentNumber: 'SC-2026-000003', status: 'ACTIVE', customerName: 'Customer' }],
      '/warehouses': [{ id: 1, code: 'HCM', name: 'Kho HCM', allowAvailableStockIssue: false }],
      '/goods-issue-requests': [],
    });
    wrap(<GoodsIssueRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo đề nghị xuất' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Hợp đồng bán/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'SC-2026-000003: Customer' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Kho/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'HCM: Kho HCM' }));
    expect(await screen.findByText('PR-2026-000009 · PN-1: Switch')).toBeTruthy();
    expect(screen.getByText(/còn được đề nghị 4, đã nhập kho 2/)).toBeTruthy();
    expect(screen.queryByText('PR-2026-000010 · CB-1: Cable')).toBeNull(); // materials are a separate request
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '3' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Tạo đề nghị xuất' }).at(-1)!);
    await waitFor(() => expect(posts).toEqual([{
      url: '/goods-issue-requests',
      body: { issueType: 'PURCHASE_REQUISITION', salesContractId: 3, warehouseId: 1, lines: [{ purchaseRequisitionLineId: 51, quantity: 3 }] },
    }]));
  });
});

describe('GIR A/C detail: first GR and received (PR code #6)', () => {
  it('shows the first GR with its warehouse and the received quantity, or "not received"', async () => {
    const base = { documentNumber: 'GIR-2026-000004', issueType: 'PURCHASE_REQUISITION', category: 'SALES_GOODS', approvalStatus: 'APPROVED', approvalStep: null,
      executionStatus: 'NOT_STARTED', salesContractNumber: 'SC-1', warehouseCode: 'HCM', createdByName: 'PM', assignedApproverName: 'A', createdAt: '2026-11-14T00:00:00Z',
      version: 3, warehouseId: 1, salesContractId: 1, createdBy: 2, assignedApproverId: 3, warehouseApproverName: null, completionReason: null, goodsIssues: [], history: [] };
    const line = { prNumber: 'PR-2026-000001', salesContractLineId: 1, contractItem: 'Switch', contractQuantity: '10', productId: 5, partNumber: 'PN-1',
      productName: 'Switch', isSerialTracked: false, uom: 'PCS', quantity: '10', productConfirmed: true, issuedQuantity: '0', committedQuantity: '0' };
    const gir = { ...base, id: 4, lines: [
      { ...line, id: 41, firstGoodsReceipt: { goodsReceiptId: 9, documentNumber: 'GR-2026-000009', warehouseCode: 'HCM' }, receivedQuantity: 7 },
      { ...line, id: 42, partNumber: 'PN-2', firstGoodsReceipt: null, receivedQuantity: 0 },
    ] };
    mockApi({ '/auth/me': me(['GIR.VIEW']), '/goods-issue-requests/4': gir, '/goods-issue-requests': [gir] });
    wrap(<GoodsIssueRequestsPage />);
    fireEvent.click(await screen.findByText('GIR-2026-000004'));
    expect(await screen.findByText('GR-2026-000009 · HCM')).toBeTruthy();
    expect(screen.getByText('Chưa nhập kho')).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: '7' })).toBeTruthy();
  });
});

describe('GIR B/D form (PR code #7)', () => {
  it('D: picks one source HĐ + Sales in the warehouse, requires a purpose and posts the source with product-only lines', async () => {
    const posts = mockApi({
      '/auth/me': { id: 1, permissions: ['GIR.VIEW', 'GIR.CREATE'], warehouseIds: [2] },
      '/warehouses/2/available-stock-sources': [
        { sourceSalesContractId: 8, sourceSalesContractNumber: 'SC-2026-000008', sourceOwnerUserId: 5, sourceOwnerName: 'Sales A', productId: 31, partNumber: 'CB-1', productName: 'Cable', available: 6 },
        { sourceSalesContractId: 9, sourceSalesContractNumber: 'SC-2026-000009', sourceOwnerUserId: 6, sourceOwnerName: 'Sales B', productId: 31, partNumber: 'CB-1', productName: 'Cable', available: 40 },
      ],
      '/sales-contracts': [{ id: 3, documentNumber: 'SC-2026-000003', status: 'ACTIVE', customerName: 'Customer' }],
      '/warehouses': [{ id: 2, code: 'KTH', name: 'Kho hàng thừa', allowAvailableStockIssue: true }],
      '/goods-issue-requests': [],
    });
    wrap(<GoodsIssueRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo đề nghị xuất' }));
    const pick = async (label: RegExp, option: string) => {
      fireEvent.mouseDown(await screen.findByRole('combobox', { name: label }));
      fireEvent.click(await screen.findByRole('option', { name: option }));
    };
    await pick(/Loại xuất/, 'Xuất hàng có sẵn');
    await pick(/Phân loại/, 'Vật tư');
    await pick(/Hợp đồng bán/, 'SC-2026-000003: Customer');
    await pick(/^Kho/, 'KTH: Kho hàng thừa');
    await pick(/Nguồn hàng/, 'SC-2026-000008 · Sales A');
    expect(await screen.findByText(/CB-1: Cable — Tồn khả dụng ở nguồn: 6/)).toBeTruthy(); // only the chosen source's stock
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '4' } });
    const submit = screen.getAllByRole('button', { name: 'Tạo đề nghị xuất' }).at(-1)! as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // purpose missing
    fireEvent.change(screen.getByLabelText(/Mục đích sử dụng/), { target: { value: 'Lắp đặt' } });
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toEqual([{
      url: '/goods-issue-requests',
      body: { issueType: 'AVAILABLE_STOCK', salesContractId: 3, warehouseId: 2, purpose: 'Lắp đặt', category: 'MATERIAL', sourceSalesContractId: 8, sourceOwnerUserId: 5,
        lines: [{ productId: 31, quantity: 4 }] },
    }]));
  });
});
