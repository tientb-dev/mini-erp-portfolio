import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { PrNotifications, PurchaseOrdersPage, PurchaseRequisitionsPage } from '.';

it('PR18: the assigned receiver can receive, and goods stay visible across tabs', async () => {
  const pr = {
    id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'WAITING_FOR_RECEIPT', actionPermissions: ['PR.RECEIVE'], version: 3, approvalRound: 1,
    createdBy: 2, createdByName: 'Sales', assignedApproverId: 1, assignedApproverName: 'Purchaser',
    createdAt: '2026-11-13T00:00:00Z', category: 'SALES_GOODS', salesContractNumber: 'SC-5', customerName: 'Customer',
    children: [], history: [], notesCursor: 2,
    notes: [{ id: 2, body: 'Ghi chú đã lưu', authorName: 'Sales', createdAt: '2026-11-13T00:00:00Z' }],
    lines: [{ id: 8, sourceLineId: 9, partNumber: 'PN-5', productName: 'Switch', uom: 'PCS', quantity: '2' }],
  };
  const posts = mockApi({
    '/auth/me': me(['PR.RECEIVE']), '/purchase-requisitions/5': pr, '/purchase-requisitions': [pr],
    '/purchase-requisitions/5/notes?before=2': {
      items: [{ id: 1, body: 'Ghi chú trước đó', authorName: 'Sales', createdAt: '2026-11-12T00:00:00Z' }], nextCursor: null,
    },
  });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  expect(await screen.findByText('Chờ tiếp nhận')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Ghi chú' }));
  expect(screen.getByText('Ghi chú đã lưu')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải thêm' }));
  expect(await screen.findByText('Ghi chú trước đó')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tải thêm' })).toBeNull();
  expect(screen.getByRole('cell', { name: 'PN-5' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận' }));
  fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]')!);
  await waitFor(() => expect(posts).toEqual([{ url: '/purchase-requisitions/5/receive', body: { version: 3, round: 1, step: 'RECEIPT' } }]));
});

it.each([false, true])('keeps the PR submit context after refresh (hidden source: %s)', async (hiddenSource) => {
  const pr = {
    id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'DRAFT', canEdit: true, actionPermissions: ['PR.CREATE'], version: 2, approvalRound: 0,
    createdBy: 1, createdByName: 'Sales', assignedApproverId: null, salesContractNumber: hiddenSource ? null : 'SC-5',
    createdAt: '2026-11-13T00:00:00Z', category: hiddenSource ? 'SALES_GOODS' : 'MATERIAL', salesContractId: hiddenSource ? null : 9, children: [], history: [], notes: [],
    draftApproverId: 2, draftReceiverId: 2, name: 'PR fixture',
    lines: [{ id: 8, productId: 4, sourceLineId: null, partNumber: 'PN-5', productName: 'Switch', uom: 'PCS', quantity: '2', brandId: 1, supplierId: 2, unitOfMeasureId: 1, taxRateId: 1, unitPrice: '8' }],
  };
  const candidate = { id: 2, username: 'candidate', fullName: 'Candidate', role: 'Configured workflow role' };
  const posts = mockApi({
    '/auth/me': me(['PR.CREATE']), '/purchase-requisitions/5': pr,
    '/purchase-requisitions/5/candidates': { approvers: [candidate], receivers: [candidate] },
    '/purchase-requisitions/5/dossier': { rows: [], canManage: false },
  });
  function TestPage() {
    const client = useQueryClient();
    return <>
      <button onClick={() => client.setQueryData(['pr', 5], { ...pr, version: 3 })}>Refresh fixture</button>
      <PurchaseRequisitionsPage initialId={5} />
    </>;
  }
  wrap(<TestPage />);
  const refresh = screen.getByRole('button', { name: 'Refresh fixture' });
  fireEvent.click(await screen.findByRole('tab', { name: 'Hồ sơ' }));
  expect(await within(screen.getByRole('tabpanel')).findByText('Chưa có hồ sơ')).toBeTruthy();
  fireEvent.click(await screen.findByRole('tab', { name: 'Người phê duyệt' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Người duyệt' }).textContent).toContain('Candidate'));
  expect(screen.getAllByText('Configured workflow role')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
  fireEvent.click(refresh);
  fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]')!);
  await waitFor(() => expect(posts).toEqual([{
    url: '/purchase-requisitions/5/submit-edited',
    body: { version: 2, round: 0, step: 'CREATE', name: 'PR fixture', purpose: '', description: '', requisitionDate: null, requiredDate: null,
      approverId: 2, receiverId: 2, lines: [{ id: 8, productId: 4, ...(hiddenSource ? {} : { salesContractLineId: null }), requirementDescription: '', brandId: 1, supplierId: 2, unitOfMeasureId: 1, taxRateId: 1, unitPrice: '8', quantity: '2' }] },
  }]));
});

it('keeps deletion local, allows cancellation, and blocks save and submit after deleting the last row', async () => {
  const pr = {
    id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'DRAFT', canEdit: true, actionPermissions: ['PR.CREATE'], version: 2, approvalRound: 0,
    createdBy: 1, createdByName: 'Sales', salesContractId: 9, salesContractNumber: 'SC-5', category: 'MATERIAL',
    children: [], history: [], lines: [{ id: 8, productId: 4, partNumber: 'PN-5', productName: 'Switch', uom: 'PCS', quantity: '2' }],
  };
  const posts = mockApi({
    '/auth/me': me(['PR.CREATE']), '/purchase-requisitions/5': pr,
    '/purchase-requisitions/5/candidates': { approvers: [], receivers: [] },
  });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Mục đích đề nghị' }), { target: { value: 'Retained purpose' } });
  const remove = screen.getByRole('button', { name: 'Xóa dòng 1' });
  fireEvent.click(remove);
  expect(within(screen.getByRole('dialog')).getByText(/1 · PN-5 · Switch/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy bỏ' }));
  expect(screen.getByRole('cell', { name: 'PN-5' })).toBeTruthy();
  fireEvent.click(remove);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa hàng hóa' }));
  expect(screen.getByText('Chưa có hàng hóa')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
  expect(screen.getByRole('alert').textContent).toMatch(/ít nhất một dòng/);
  expect((screen.getByRole('textbox', { name: 'Mục đích đề nghị' }) as HTMLTextAreaElement).value).toBe('Retained purpose');
  expect(posts).toEqual([]);
});

it('deletes selected PR line IDs locally, preserves order, and saves only retained rows', async () => {
  const lines = [
    { id: 8, partNumber: 'PN-5', productName: 'First duplicate', quantity: '1' },
    { id: 9, partNumber: 'PN-5', productName: 'Retained duplicate', quantity: '2' },
    { id: 10, partNumber: 'PN-6', productName: 'Removed item', quantity: '3' },
    { id: 11, partNumber: 'PN-7', productName: 'Retained item', quantity: '4' },
  ].map(line => ({ ...line, productId: 4, uom: 'PCS', unitPrice: '100', taxRate: '0' }));
  const pr = {
    id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'DRAFT', canEdit: true, actionPermissions: ['PR.CREATE'], version: 2, approvalRound: 0,
    createdBy: 1, createdByName: 'Sales', salesContractId: 9, salesContractNumber: 'SC-5', category: 'MATERIAL',
    children: [], history: [], lines,
  };
  const posts = mockApi({
    '/auth/me': me(['PR.CREATE']), '/purchase-requisitions/5': pr,
    '/purchase-requisitions/5/candidates': { approvers: [], receivers: [] },
  });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  const row = (name: string) => screen.getByRole('cell', { name }).closest('tr')!;
  const choose = (name: string) => fireEvent.click(within(row(name)).getByRole('checkbox'));
  expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Xóa (0)' })).disabled).toBe(true);
  choose('First duplicate');
  choose('Removed item');
  fireEvent.click(screen.getByRole('button', { name: 'Xóa (2)' }));
  let dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('Bạn có chắc chắn muốn xóa 2 dòng hàng hóa đã chọn?')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'Hủy bỏ' }));
  expect((within(row('First duplicate')).getByRole<HTMLInputElement>('checkbox')).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Xóa (2)' }));
  dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'Xóa hàng hóa' }));
  expect(screen.queryByText('First duplicate')).toBeNull();
  expect(screen.queryByText('Removed item')).toBeNull();
  expect(within(row('Retained duplicate')).getByRole('cell', { name: '1' })).toBeTruthy();
  expect(within(row('Retained item')).getByRole('cell', { name: '2' })).toBeTruthy();
  expect(screen.getByText('2 dòng hàng hóa')).toBeTruthy();
  expect(screen.getByText('600 VND')).toBeTruthy();
  expect(screen.queryByTestId('WarningAmberRoundedIcon')).toBeNull();
  expect((screen.getByRole<HTMLButtonElement>('button', { name: 'Xóa (0)' })).disabled).toBe(true);
  expect(posts).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await waitFor(() => expect(posts[0]).toMatchObject({
    url: '/purchase-requisitions/5', body: { lines: [{ id: 9 }, { id: 11 }] },
  }));
});

it('blocks save and submit after deleting all selected rows', async () => {
  const pr = {
    id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'DRAFT', canEdit: true, actionPermissions: ['PR.CREATE'], version: 2, approvalRound: 0,
    createdBy: 1, createdByName: 'Sales', salesContractId: 9, salesContractNumber: 'SC-5', category: 'MATERIAL',
    children: [], history: [], lines: [{ id: 8, productId: 4, partNumber: 'PN-5', productName: 'Switch', uom: 'PCS', quantity: '2' }],
  };
  const posts = mockApi({
    '/auth/me': me(['PR.CREATE']), '/purchase-requisitions/5': pr,
    '/purchase-requisitions/5/candidates': { approvers: [], receivers: [] },
  });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn tất cả dòng đang hiển thị' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xóa (1)' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa hàng hóa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
  expect(screen.getByRole('alert').textContent).toMatch(/ít nhất một dòng/);
  expect(posts).toEqual([]);
});

it('clears only the PR search keyword and resets the page', async () => {
  mockApi({ '/auth/me': me(['PR.VIEW']), '/purchase-requisitions': { items: [], total: 100 } });
  wrap(<PurchaseRequisitionsPage />, '/purchase-requisitions?q=Relay&category=MATERIAL&sort=name&direction=asc&page=2');
  const search = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Tìm kiếm' });
  expect(search.placeholder).toBe('Nhập mã PR, tên PR, mã HĐ hoặc tên khách hàng...');
  expect(search.value).toBe('Relay');
  fireEvent.click(screen.getByRole('button', { name: 'Xóa từ khóa tìm kiếm' }));
  expect(search.value).toBe('');
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([request]) => {
    const url = new URL(String(request));
    return url.pathname === '/purchase-requisitions' && !url.searchParams.has('q')
      && url.searchParams.get('category') === 'MATERIAL' && url.searchParams.get('sort') === 'name'
      && url.searchParams.get('direction') === 'asc' && url.searchParams.get('page') === '1';
  })).toBe(true));
});

it('shows Reassign only on the pending card and requires a replacement and a reason', async () => {
  const pr = {
    id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'WAITING_FOR_APPROVE', actionPermissions: ['PR.CREATE'], version: 2, approvalRound: 1,
    createdBy: 1, createdByName: 'Sales', assignedApproverId: 2, assignedApproverName: 'Original',
    createdAt: '2026-11-13T00:00:00Z', category: 'MATERIAL', children: [], history: [], notes: [], lines: [],
    canReassign: true, nodes: [{ step: 'APPROVAL', round: 1, assigneeName: 'Original' }],
  };
  const posts = mockApi({
    '/auth/me': me(['PR.CREATE']), '/purchase-requisitions/5': pr,
    '/purchase-requisitions/5/reassignment-candidates': { candidates: [{ id: 3, fullName: 'New Assignee', username: 'new' }] },
  });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Người phê duyệt' }));
  const button = screen.getByRole('button', { name: 'Phân công lại' });
  expect(button.closest('section')).toBeNull(); // footer is a section
  fireEvent.click(button);
  const dialog = within(await screen.findByRole('dialog'));
  const current = dialog.getByRole('textbox', { name: 'Người xử lý hiện tại' }) as HTMLInputElement;
  expect([current.value, current.readOnly]).toEqual(['Original', true]);
  const confirm = dialog.getByRole('button', { name: 'Phân công lại' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: /Người xử lý mới/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'New Assignee (new)' }));
  expect(confirm.disabled).toBe(true);
  fireEvent.change(dialog.getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Bàn giao' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(posts).toEqual([{
    url: '/purchase-requisitions/5/reassign', body: { version: 2, round: 1, step: 'APPROVAL', assigneeId: 3, reason: 'Bàn giao' },
  }]));
});

it('distinguishes an open receipt task from a closed approval task and an approval event', async () => {
  const common = { prId: 5, documentNumber: 'PR-005', createdAt: '2026-11-13T00:00:00Z', readAt: null };
  mockApi({ '/pr-notifications': [
    { ...common, id: 3, action: 'REQUEST_RECEIPT', taskStep: 'RECEIPT', resolvedAt: null },
    { ...common, id: 2, action: 'APPROVE', taskStep: null, resolvedAt: null },
    { ...common, id: 1, action: 'REQUEST_APPROVAL', taskStep: 'APPROVAL', resolvedAt: common.createdAt },
  ] });
  wrap(<PrNotifications userId={1} openPr={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
  expect(await screen.findByText('PR-005 · Yêu cầu bạn tiếp nhận')).toBeTruthy();
  expect(screen.getByText('PR-005 · Đã phê duyệt, đang chờ tiếp nhận')).toBeTruthy();
  expect(screen.getByText(/Công việc đã kết thúc/)).toBeTruthy();
});

describe('Purchase order form', () => {
  it('blocks quantities above what the PR line still allows', async () => {
    const posts = mockApi({
      '/auth/me': me(['PO.VIEW', 'PO.CREATE']),
      '/suppliers': [{ id: 7, code: 'S1', name: 'Supplier 1' }],
      '/purchase-requisition-lines/available-for-po': [{ id: 5, prNumber: 'PR-2026-000001', partNumber: 'PN-1', productName: 'Switch', uom: 'PCS', quantity: '10', remaining: '4' }],
      '/purchase-orders': [],
    });
    wrap(<PurchaseOrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo đơn đặt hàng' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Nhà cung cấp/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'S1: Supplier 1' }));
    const qty = await screen.findByLabelText('Số lượng');
    fireEvent.change(qty, { target: { value: '5' } });
    expect(screen.getByText('Tối đa 4')).toBeTruthy();
    const submit = screen.getAllByRole('button', { name: 'Tạo đơn đặt hàng' }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(qty, { target: { value: '4' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toEqual([{ url: '/purchase-orders', body: { supplierId: 7, lines: [{ sourceLineId: 5, quantity: 4 }] } }]));
  });
});

describe('Document editing (IM18)', () => {
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

  it('edits a retained PO line by its own ID when the source PR is hidden', async () => {
    const row = rejectedPo(1);
    const hidden = { ...row, lines: [{ ...row.lines[0], sourceLineId: null, ref: null }] };
    const posts = mockApi({
      '/auth/me': me(['PO.VIEW', 'PO.CREATE']), '/suppliers': [{ id: 7, code: 'S1', name: 'Supplier 1' }],
      '/purchase-requisition-lines/available-for-po': [], '/purchase-orders/40': hidden, '/purchase-orders': [hidden],
    });
    wrap(<PurchaseOrdersPage />);
    fireEvent.click(await screen.findByText('PO-2026-000007'));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    const qty = await screen.findByLabelText(/PN-1: Switch/);
    fireEvent.change(qty, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(posts).toEqual([{
      url: '/purchase-orders/40', body: { version: 3, supplierId: 7, lines: [{ id: 31, quantity: 3 }] },
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
