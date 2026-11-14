import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { GoodsIssueRequestsPage } from '.';

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

describe('UAT Round 1 fixes (PR #14)', () => {
  it('UAT-1: an A/C quantity above what is still requestable shows a warning with the max, and the draft can still be created', async () => {
    const posts = mockApi({
      '/auth/me': me(['GIR.VIEW', 'GIR.CREATE']),
      '/sales-contracts/3/gir-pr-lines': [
        { id: 51, purchaseRequisitionId: 9, prNumber: 'PR-2026-000009', category: 'SALES_GOODS', partNumber: 'PN-1', productName: 'Switch', uom: 'PCS', quantity: '5', receivedQuantity: '0', remainingQuantity: 4 },
      ],
      '/sales-contracts': [{ id: 3, documentNumber: 'SC-2026-000003', status: 'ACTIVE', customerName: 'Customer' }],
      '/warehouses': [{ id: 1, code: 'HCM', name: 'Kho HCM', allowAvailableStockIssue: false }],
      '/goods-issue-requests': [],
    });
    wrap(<GoodsIssueRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo đề nghị xuất' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Hợp đồng bán/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'SC-2026-000003: Customer' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /^Kho/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'HCM: Kho HCM' }));
    const qty = await screen.findByLabelText('Số lượng');
    fireEvent.change(qty, { target: { value: '6' } });
    expect(await screen.findByText(/Vượt số còn được đề nghị \(tối đa 4\)/)).toBeTruthy();
    const submit = screen.getAllByRole('button', { name: 'Tạo đề nghị xuất' }).at(-1)! as HTMLButtonElement;
    expect(submit.disabled).toBe(false); // CT2: a DRAFT above the quota is allowed
    fireEvent.change(qty, { target: { value: '4' } });
    expect(screen.queryByText(/Vượt số còn được đề nghị/)).toBeNull();
    fireEvent.change(qty, { target: { value: '6' } });
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toEqual([{
      url: '/goods-issue-requests', body: { issueType: 'PURCHASE_REQUISITION', salesContractId: 3, warehouseId: 1, lines: [{ purchaseRequisitionLineId: 51, quantity: 6 }] },
    }]));
  });

  const bdGir = (step: number) => ({
    id: 7, documentNumber: 'GIR-2026-000007', issueType: 'AVAILABLE_STOCK', category: 'SALES_GOODS', approvalStatus: 'WAITING_FOR_APPROVE', approvalStep: step,
    executionStatus: 'NOT_STARTED', salesContractNumber: 'SC-3', warehouseCode: 'KTH', createdByName: 'PM', assignedApproverName: 'Me', createdAt: '2026-11-14T00:00:00Z',
    version: 2, warehouseId: 1, salesContractId: 3, createdBy: 2, assignedApproverId: 1, warehouseApproverName: 'Kho', completionReason: null,
    sourceSalesContractNumber: 'SC-2', sourceOwnerName: 'Sales 2', purpose: null, lines: [], goodsIssues: [], history: [],
  });
  it('UAT-3: step 1 of an available-stock GIR is labelled "Xác nhận" (title, button, hint); the API call is still approve', async () => {
    const posts = mockApi({ '/auth/me': me(['GIR.VIEW', 'GIR.SALES_CONFIRM']), '/goods-issue-requests/7': bdGir(1), '/goods-issue-requests': [bdGir(1)] });
    wrap(<GoodsIssueRequestsPage />);
    fireEvent.click(await screen.findByText('GIR-2026-000007'));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Xác nhận cho mượn hàng');
    expect(dialog.textContent).toContain('Sales nguồn');
    expect(dialog.textContent).not.toContain('Duyệt chứng từ');
    fireEvent.click(screen.getAllByRole('button', { name: 'Xác nhận' }).at(-1)!);
    await waitFor(() => expect(posts).toEqual([{ url: '/goods-issue-requests/7/approve', body: {} }]));
  });

  it('UAT-3: step 2 (warehouse manager) stays "Duyệt"', async () => {
    mockApi({ '/auth/me': me(['GIR.VIEW', 'GIR.APPROVE']), '/goods-issue-requests/7': bdGir(2), '/goods-issue-requests': [bdGir(2)] });
    wrap(<GoodsIssueRequestsPage />);
    fireEvent.click(await screen.findByText('GIR-2026-000007'));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Duyệt chứng từ');
    expect(dialog.textContent).not.toContain('Xác nhận cho mượn hàng');
  });
});
