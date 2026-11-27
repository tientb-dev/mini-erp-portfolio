import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { wrap } from '../../test/helpers/api';
import { OrgUnitsPage } from './OrgUnitsPage';

const nodes = [
  { id: 1, code: 'CTY', name: 'Công ty', parentId: null, isActive: true, version: 1 },
  { id: 2, code: 'KD', name: 'Khối kinh doanh', parentId: 1, isActive: true, version: 1 },
  { id: 3, code: 'KD1', name: 'Phòng kinh doanh 1', parentId: 2, isActive: true, version: 1 },
  { id: 4, code: 'KT', name: 'Phòng kế toán', parentId: 1, isActive: false, version: 2 },
];
const kd = { id: 2, code: 'KD', name: 'Khối kinh doanh', description: 'Bán hàng', isActive: true, version: 3, headUserId: null,
  parent: { id: 1, code: 'CTY', name: 'Công ty' } };
const me = (permissions: string[]) => ({ id: 1, username: 'admin', permissions, warehouseIds: [] });

type Call = { method: string; url: string; body: unknown };
function serve(permissions = ['ORGANIZATION.VIEW', 'ORGANIZATION.MANAGE']) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (status: number, payload?: unknown) => new Response(status === 204 ? null : JSON.stringify(payload ?? {}), { status });
    if (url === '/auth/me') return reply(200, me(permissions));
    if (url === '/admin/org-units/tree') return reply(200, nodes);
    if (url === '/admin/org-units/2' && method === 'GET') return reply(200, kd);
    if (url === '/admin/org-units/2/history') return reply(200, { items: [], nextCursor: null });
    if (method === 'POST') return reply(201, { id: 9 });
    if (method === 'PUT') return reply(204);
    if (url === '/admin/org-units/9') return reply(200, { ...kd, id: 9 });
    throw new Error(`unexpected ${method} ${url}`);
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('Organization structure', () => {
  it('shows the tree with inactive units, searches keeping the ancestor path, and expands/collapses all', async () => {
    serve();
    wrap(<OrgUnitsPage />, '/org-units');
    await screen.findByText('CTY · Công ty');
    const tree = screen.getByRole('list', { name: 'Cơ cấu tổ chức' });
    expect(within(tree).getByText('CTY · Công ty')).toBeTruthy();
    expect(within(tree).queryByText('KD · Khối kinh doanh')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng toàn bộ' }));
    expect(await within(tree).findByText('KD1 · Phòng kinh doanh 1')).toBeTruthy();
    expect(within(tree).getByText('KT · Phòng kế toán')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn toàn bộ' }));
    await waitFor(() => expect(within(tree).queryByText('KD · Khối kinh doanh')).toBeNull());

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'kinh doanh 1' } });
    expect(await within(tree).findByText('KD1 · Phòng kinh doanh 1')).toBeTruthy();
    expect(within(tree).getByText('KD · Khối kinh doanh')).toBeTruthy();
    expect(within(tree).getByText('CTY · Công ty')).toBeTruthy();
    expect(within(tree).queryByText('KT · Phòng kế toán')).toBeNull();
  });

  it('opens the selected unit on the General tab and adds a child unit under it', async () => {
    const calls = serve();
    wrap(<OrgUnitsPage initialId={2} />, '/org-units/2');
    expect(await screen.findByRole('tab', { name: 'Thông tin chung', selected: true })).toBeTruthy();
    expect(screen.getByDisplayValue('CTY · Công ty')).toBeTruthy();
    expect(screen.getByDisplayValue('Chưa chỉ định')).toBeTruthy();
    expect((screen.getByLabelText('Số đơn vị con trực tiếp') as HTMLInputElement).value).toBe('1');
    // F05: KD still has an active child, so deactivation is blocked up front.
    expect((screen.getByRole('button', { name: 'Ngừng sử dụng' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm đơn vị con' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Thêm đơn vị con')).toBeTruthy();
    expect(within(dialog).queryByText(/Đơn vị cha: /)).toBeNull();
    expect(within(dialog).queryByText('Đang dùng')).toBeNull();
    expect(within(dialog).queryByText(/OA2/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Mã đơn vị/), { target: { value: 'KD2' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên đơn vị/), { target: { value: 'Phòng kinh doanh 2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm mới' }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body)
      .toEqual({ code: 'KD2', name: 'Phòng kinh doanh 2', description: null, parentId: 2 }));
  });

  it('asks for confirmation before changing the parent and offers neither the unit, its subtree nor inactive units', async () => {
    const calls = serve();
    wrap(<OrgUnitsPage initialId={2} />, '/org-units/2');
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Chỉnh sửa đơn vị')).toBeTruthy();
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Đơn vị cha' }));
    const options = (await screen.findAllByRole('option')).map(o => o.textContent);
    expect(options).toEqual(['— Đơn vị gốc —', 'CTY · Công ty']);
    fireEvent.click(screen.getByRole('option', { name: '— Đơn vị gốc —' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Lưu/ }));
    const confirm = (await screen.findAllByRole('dialog')).find(d => d.textContent?.includes('Xác nhận chuyển đơn vị cha'))!;
    expect(within(confirm).getByText(/Phạm vi dữ liệu/)).toBeTruthy();
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Chuyển đơn vị' }));
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')?.body)
      .toEqual({ name: 'Khối kinh doanh', description: 'Bán hàng', parentId: null, version: 3 }));
  });

  it('hides every write action from a viewer', async () => {
    serve(['ORGANIZATION.VIEW']);
    wrap(<OrgUnitsPage initialId={2} />, '/org-units/2');
    expect(await screen.findByRole('tab', { name: 'Thông tin chung' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm đơn vị con' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm đơn vị' })).toBeNull();
  });
});
