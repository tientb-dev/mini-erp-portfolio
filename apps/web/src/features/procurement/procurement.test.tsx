import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { PurchaseOrdersPage, PurchaseRequisitionsPage } from '.';

it('PR18: the assigned receiver can receive, and goods stay visible across tabs', async () => {
  const pr = {
    id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'WAITING_FOR_RECEIPT', version: 3,
    createdBy: 2, createdByName: 'Sales', assignedApproverId: 1, assignedApproverName: 'Purchaser',
    createdAt: '2026-11-13T00:00:00Z', category: 'SALES_GOODS', salesContractNumber: 'SC-5', customerName: 'Customer',
    children: [], history: [], notes: [{ id: 1, body: 'Ghi chú đã lưu', authorName: 'Sales', createdAt: '2026-11-13T00:00:00Z' }],
    lines: [{ id: 8, sourceLineId: 9, partNumber: 'PN-5', productName: 'Switch', uom: 'PCS', quantity: '2' }],
  };
  const posts = mockApi({ '/auth/me': me(['PR.RECEIVE']), '/purchase-requisitions/5': pr, '/purchase-requisitions': [pr] });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  expect(await screen.findByText('Chờ tiếp nhận')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Ghi chú' }));
  expect(screen.getByText('Ghi chú đã lưu')).toBeTruthy();
  expect(screen.getByRole('gridcell', { name: 'PN-5' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận' }));
  fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]')!);
  await waitFor(() => expect(posts).toEqual([{ url: '/purchase-requisitions/5/approve', body: { version: 3 } }]));
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
