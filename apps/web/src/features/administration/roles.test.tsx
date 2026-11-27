import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { wrap } from '../../test/helpers/api';
import { RolesPage } from './RolesPage';

const catalog = [
  { code: 'PRODUCT.VIEW', module: 'MASTER_DATA', name: 'Xem hàng hóa', description: null, adminOnly: false },
  { code: 'PO.VIEW', module: 'PO', name: 'Xem đơn mua hàng', description: null, adminOnly: false },
  { code: 'ROLE.MANAGE', module: 'ADMINISTRATION', name: 'Quản trị vai trò', description: null, adminOnly: true },
];
const sales = { id: 5, code: 'SALES', name: 'Sales', description: 'Bán hàng', isActive: true, isSystem: false, version: 3,
  permissions: ['PRODUCT.VIEW'], users: [{ id: 7, username: 'an', fullName: 'Nguyễn An', isActive: true }, { id: 1, username: 'me', fullName: 'Tôi', isActive: true }],
  history: [
    { id: 2, action: 'ROLE_UPDATED', createdAt: '2026-11-27T02:00:00Z', actorName: 'Admin', metadata: { before: { name: 'Bán', description: null }, after: { name: 'Sales', description: 'Bán hàng' } } },
    { id: 1, action: 'ROLE_COPIED', createdAt: '2026-11-27T01:00:00Z', actorName: 'Admin',
      metadata: { after: { code: 'SALES', name: 'Bán' }, copiedFrom: { id: 3, code: 'BASE', name: 'Gốc' }, permissions: ['PRODUCT.VIEW'], users: [] } },
  ],
  historyCursor: null };
const adminRole = { ...sales, id: 1, code: 'ADMIN', name: 'Administrator', isSystem: true, permissions: catalog.map(p => p.code), users: [] };
const me = { id: 1, username: 'me', permissions: ['ROLE.VIEW', 'ROLE.MANAGE'], warehouseIds: [] };

type Call = { method: string; url: string; body: unknown };
/** Routes by method + path prefix; returns the recorded calls. */
function serve(routes: Record<string, (url: string) => [number, unknown?]>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).filter(k => { const [m, p] = k.split(' '); return m === method && url.startsWith(p!); })
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unexpected ${method} ${url}`);
    const [status, payload] = routes[key]!(url);
    return new Response(status === 204 ? null : JSON.stringify(payload ?? {}), { status });
  });
  return calls;
}
const baseRoutes = () => base;
const base = { 'GET /auth/me': () => [200, me] as [number, unknown], 'GET /admin/permissions': () => [200, catalog] as [number, unknown],
  'GET /admin/roles?': () => [200, { items: [], total: 0 }] as [number, unknown] };
const footer = () => screen.getByRole('region', { name: 'Thao tác quyết định' });

afterEach(() => vi.restoreAllMocks());

describe('Roles list', () => {
  it('shows server rows and sends search, status, sort and page; Làm mới resets them and keeps the page size', async () => {
    const calls = serve({ ...base, 'GET /admin/roles?': () => [200, { total: 2, items: [
      { id: 1, code: 'ADMIN', name: 'Administrator', description: null, isActive: true, isSystem: true, userCount: 2, permissionCount: 51 },
      { id: 5, code: 'SALES', name: 'Sales', description: 'Bán hàng', isActive: false, isSystem: false, userCount: 4, permissionCount: 9 },
    ] }] });
    wrap(<RolesPage />, '/roles?q=sal&status=false&sort=name&direction=desc&size=50');
    expect(await screen.findByRole('link', { name: 'SALES' })).toBeTruthy();
    expect(screen.getByText('51')).toBeTruthy();
    expect(Object.fromEntries(new URL('http://x' + calls.find(c => c.url.startsWith('/admin/roles?'))!.url).searchParams))
      .toMatchObject({ q: 'sal', status: 'false', sort: 'name', direction: 'desc', page: '0', size: '50' });
    expect(screen.queryByRole('button', { name: 'Sao chép ADMIN' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sao chép SALES' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xóa bộ lọc' })).toBeNull();
    const refresh = screen.getByRole('button', { name: 'Làm mới' }) as HTMLButtonElement;
    await waitFor(() => expect(refresh.disabled).toBe(false));
    fireEvent.click(refresh);
    await waitFor(() => expect(calls.filter(c => c.url.startsWith('/admin/roles?')).at(-1)!.url).toBe('/admin/roles?sort=code&direction=asc&size=50&page=0'));
  });
});

describe('Role detail', () => {
  it('shows View read-only (not disabled) with the status badge and actions in the footer only', async () => {
    serve({ ...base, 'GET /admin/roles/5': () => [200, sales] });
    wrap(<RolesPage initialId={5} />, '/roles/5');
    const code = await screen.findByLabelText('Mã vai trò') as HTMLInputElement;
    expect(code.readOnly).toBe(true);
    expect(code.disabled).toBe(false);
    expect((screen.getByLabelText('Tên vai trò') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole('switch')).toBeNull();
    // F-15: the status is shown once, in the header; F-16: Copy is back in the View footer.
    expect(screen.queryByText('Trạng thái')).toBeNull();
    expect(screen.getAllByText('Đang dùng')).toHaveLength(1);
    expect(within(footer()).getAllByRole('button').map(b => b.textContent)).toEqual(['Ngừng hoạt động', 'Sao chép', 'Sửa']);
    expect(within(footer()).getByRole('button', { name: 'Ngừng hoạt động' }).className).toMatch(/MuiButton-outlined.*MuiButton-colorError/);
    expect(within(footer()).getByRole('button', { name: 'Sao chép' }).className).toMatch(/MuiButton-outlined.*MuiButton-colorPrimary/);
    expect(within(footer()).getByRole('button', { name: 'Sửa' }).className).toContain('MuiButton-contained');
  });

  it('lists one permission per row, filters, explains admin-only keys and confirms the impact before saving', async () => {
    const calls = serve({ ...base, 'GET /admin/roles/5': () => [200, sales], 'PUT /admin/roles/5': () => [204] });
    wrap(<RolesPage initialId={5} />, '/roles/5?mode=edit');
    fireEvent.click(await screen.findByRole('tab', { name: 'Phân quyền' }));
    expect(document.querySelectorAll('[data-permission-row]')).toHaveLength(3);
    expect(screen.getByText('Đã chọn 1/3 quyền')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Quản trị vai trò (ROLE.MANAGE)' }) as HTMLInputElement).disabled).toBe(true);
    // One explanation per locked permission: the visible caption, linked to the checkbox (no duplicate tooltip).
    expect(screen.getAllByText('Chỉ dành cho vai trò hệ thống ADMIN')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Quản trị vai trò (ROLE.MANAGE)' }).getAttribute('aria-describedby')).toBe('admin-only-ROLE.MANAGE');
    expect(document.querySelector('[data-permission-toolbar]')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Tên quyền hoặc mã kỹ thuật'), { target: { value: 'PO.' } });
    expect(screen.queryByText('Xem hàng hóa')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Xem đơn mua hàng (PO.VIEW)' }));
    fireEvent.change(screen.getByPlaceholderText('Tên quyền hoặc mã kỹ thuật'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Chỉ hiển thị quyền đã chọn'));
    expect(screen.queryByText('Quản trị vai trò')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Thông tin chung' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Phân quyền' }));
    expect((screen.getByRole('checkbox', { name: 'Xem đơn mua hàng (PO.VIEW)' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu vai trò' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Thêm 1 và gỡ 0 quyền.')).toBeTruthy();
    expect(within(dialog).getByText('2 người dùng còn trong vai trò nhận thay đổi quyền kể từ lần thao tác tiếp theo.')).toBeTruthy();
    expect(within(dialog).getByText('Quyền từ các vai trò khác không thay đổi.')).toBeTruthy();
    expect(within(dialog).queryByText(/Tổng số người dùng/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true));
    expect(calls.find(c => c.method === 'PUT')!.body).toEqual({ name: 'Sales', description: 'Bán hàng', permissions: ['PRODUCT.VIEW', 'PO.VIEW'], userIds: [7, 1], version: 3 });
  });

  it('keeps the draft and explains a version conflict', async () => {
    serve({ ...base, 'GET /admin/roles/5': () => [200, sales], 'PUT /admin/roles/5': () => [409, { code: 'VERSION_CONFLICT', detail: 'changed' }] });
    wrap(<RolesPage initialId={5} />, '/roles/5?mode=edit');
    fireEvent.change(await screen.findByLabelText(/Tên vai trò/), { target: { value: 'Sales mới' } });
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu vai trò' }));
    expect(await screen.findByText(/Người khác vừa sửa vai trò này/)).toBeTruthy();
    expect((screen.getByLabelText(/Tên vai trò/) as HTMLInputElement).value).toBe('Sales mới');
  });

  it('pages the user picker server-side, keeps the selection across pages and locks assigned users', async () => {
    const page = (n: number) => n === 0
      // The server already excludes the signed-in admin (F-19): the client shows the page as received.
      ? { total: 30, items: [{ id: 9, username: 'binh', fullName: 'Trần Bình', isActive: true }, { id: 7, username: 'an', fullName: 'Nguyễn An', isActive: true }] }
      : { total: 30, items: [{ id: 40, username: 'tam', fullName: 'Lê Tâm', isActive: false }] };
    const calls = serve({ ...base, 'GET /admin/roles/5': () => [200, sales], 'PUT /admin/roles/5': () => [204],
      'GET /admin/roles/user-options': url => [200, page(Number(new URL('http://x' + url).searchParams.get('page')))] });
    wrap(<RolesPage initialId={5} />, '/roles/5?mode=edit');
    fireEvent.click(await screen.findByRole('tab', { name: 'Người dùng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi vai trò an' }));
    expect(screen.queryByRole('button', { name: 'Gỡ khỏi vai trò me' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm người dùng' }));
    const picker = await screen.findByRole('dialog');
    fireEvent.click(await within(picker).findByRole('checkbox', { name: 'binh' }));
    // 'an' was removed from the draft above, so it can be picked again.
    expect((within(picker).getByRole('checkbox', { name: 'an' }) as HTMLInputElement).disabled).toBe(false);
    expect(within(picker).getByText('Đã chọn 1 người dùng')).toBeTruthy();
    fireEvent.click(within(picker).getByRole('button', { name: /next page|Trang sau|Go to next page/i }));
    fireEvent.click(await within(picker).findByRole('checkbox', { name: 'tam' }));
    expect(within(picker).getByText('Đã chọn 2 người dùng')).toBeTruthy();
    expect(calls.some(c => c.url.includes('/admin/roles/user-options?') && c.url.includes('page=1'))).toBe(true);
    fireEvent.click(within(picker).getByRole('button', { name: 'Thêm vào vai trò' }));
    expect(await screen.findByText('Trần Bình')).toBeTruthy();
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu vai trò' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true));
    expect((calls.find(c => c.method === 'PUT')!.body as { userIds: number[] }).userIds).toEqual([1, 9, 40]);
  });

  it('shows ADMIN with every permission read-only and only Edit in the footer', async () => {
    serve({ ...base, 'GET /admin/roles/1': () => [200, adminRole] });
    wrap(<RolesPage initialId={1} />, '/roles/1');
    expect(await screen.findByText('Vai trò hệ thống: chỉ sửa được tên và mô tả.')).toBeTruthy();
    expect(within(footer()).getAllByRole('button').map(b => b.textContent)).toEqual(['Sửa']);
    fireEvent.click(within(footer()).getByRole('button', { name: 'Sửa' }));
    expect((screen.getByLabelText('Mã vai trò') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText(/Tên vai trò/) as HTMLInputElement).readOnly).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Phân quyền' }));
    for (const p of catalog) expect((screen.getByRole('checkbox', { name: `${p.name} (${p.code})` }) as HTMLInputElement).checked).toBe(true);
  });

  it('validates on Save only (FE-VALIDATION-001): no error on open, Save stays enabled, the first error gets focus', async () => {
    const calls = serve({ ...base, 'GET /admin/roles/5': () => [200, sales], 'POST /admin/roles': () => [201, { id: 12 }],
      'GET /admin/roles/12': () => [200, { ...sales, id: 12, code: 'SALES_2', users: [] }] });
    wrap(<RolesPage initialId={0} />, '/roles/new');
    const code = await screen.findByLabelText(/Mã vai trò/) as HTMLInputElement;
    expect(code.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByText('Nhập tên vai trò.')).toBeNull();
    const save = within(footer()).getByRole('button', { name: 'Lưu vai trò' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Phân quyền' }));
    fireEvent.click(save);
    expect(await screen.findByText('Nhập mã vai trò.')).toBeTruthy();
    expect(screen.getByText('Nhập tên vai trò.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Mã vai trò/)));
    fireEvent.change(screen.getByLabelText(/Mã vai trò/), { target: { value: '9bad' } });
    expect(screen.getByText(/Mã bắt đầu bằng chữ in hoa/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Mã vai trò/), { target: { value: 'kt' } });
    fireEvent.change(screen.getByLabelText(/Tên vai trò/), { target: { value: 'Kế toán' } });
    expect(screen.queryByText('Nhập tên vai trò.')).toBeNull();
    expect(screen.getByLabelText(/Tên vai trò/).getAttribute('aria-invalid')).toBe('false');
    fireEvent.click(save);
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true));
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ code: 'KT', name: 'Kế toán', description: null, permissions: [], userIds: [] });
  });

  it('prefills a copy without code or users and shows a duplicate code next to the field', async () => {
    serve({ ...base, 'GET /admin/roles/5': () => [200, sales], 'POST /admin/roles': () => [409, { code: 'DUPLICATE_VALUE', detail: 'dup' }] });
    wrap(<RolesPage initialId={0} />, '/roles/new?copy=5');
    const code = await screen.findByLabelText(/Mã vai trò/) as HTMLInputElement;
    expect(code.value).toBe('');
    expect((screen.getByLabelText(/Tên vai trò/) as HTMLInputElement).value).toBe('Sales');
    fireEvent.change(code, { target: { value: 'SALES' } });
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu vai trò' }));
    expect(await screen.findByText('Mã vai trò đã tồn tại. Nhập mã khác.')).toBeTruthy();
    expect((screen.getByLabelText(/Mã vai trò/) as HTMLInputElement).value).toBe('SALES');
  });

  it('warns before deactivating with a destructive action and renders the shared activity history', async () => {
    const calls = serve({ ...base, 'GET /admin/roles/5': () => [200, sales], 'PATCH /admin/roles/5/status': () => [204] });
    wrap(<RolesPage initialId={5} />, '/roles/5');
    fireEvent.click(await screen.findByRole('tab', { name: 'Lịch sử' }));
    expect(screen.getByText('Sao chép từ BASE (Gốc)')).toBeTruthy();
    expect(screen.getByText(/Bán → Sales/)).toBeTruthy();
    expect(screen.queryByText(/\{"/)).toBeNull();
    fireEvent.click(within(footer()).getByRole('button', { name: 'Ngừng hoạt động' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('SALES · Sales')).toBeTruthy();
    expect(within(dialog).getByText(/2 người dùng sẽ bị thu hồi .*Quyền từ các vai trò khác của họ vẫn được giữ/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Ngừng hoạt động' });
    expect(confirm.className).toMatch(/MuiButton-colorError/);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ isActive: false, version: 3 }));
  });
});

describe('Confirm Save reports who the change affects (F-OA1.3-18)', () => {
  const role = (overrides: Partial<typeof sales>) => ({ ...sales, users: [{ id: 7, username: 'an', fullName: 'Nguyễn An', isActive: true }], ...overrides });
  async function confirmFor(base: object, edit: () => Promise<void> | void) {
    serve({ ...baseRoutes(), 'GET /admin/roles/5': () => [200, base], 'PUT /admin/roles/5': () => [204],
      'GET /admin/roles/user-options': () => [200, { total: 3, items: [{ id: 7, username: 'an', fullName: 'Nguyễn An', isActive: true },
        { id: 9, username: 'binh', fullName: 'Trần Bình', isActive: true }, { id: 10, username: 'chi', fullName: 'Lê Chi', isActive: true }] }] });
    wrap(<RolesPage initialId={5} />, '/roles/5?mode=edit');
    await screen.findByLabelText(/Tên vai trò/);
    await edit();
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu vai trò' }));
  }
  const addTwoUsers = async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Người dùng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm người dùng' }));
    const picker = await screen.findByRole('dialog');
    fireEvent.click(await within(picker).findByRole('checkbox', { name: 'binh' }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'chi' }));
    // Already in the role: listed, checked and locked (not selectable again).
    const assigned = within(picker).getByRole('checkbox', { name: 'an' }) as HTMLInputElement;
    expect([assigned.checked, assigned.disabled]).toEqual([true, true]);
    expect(within(picker).getByText('Đã chọn 2 người dùng')).toBeTruthy();
    fireEvent.click(within(picker).getByRole('button', { name: 'Thêm vào vai trò' }));
    await screen.findByText('Lê Chi');
  };
  const addPermission = () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Phân quyền' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Xem đơn mua hàng (PO.VIEW)' }));
  };
  const lines = async () => (await screen.findByRole('dialog')).textContent ?? '';

  it('only adding users: added count, total after saving, added users get the role', async () => {
    await confirmFor(role({}), addTwoUsers);
    const text = await lines();
    expect(text).toContain('Thêm người dùng: 2.');
    expect(text).toContain('Tổng số người dùng sau khi lưu: 3.');
    expect(text).toContain('Người dùng được thêm sẽ nhận các quyền từ vai trò này');
    expect(text).not.toContain('còn trong vai trò nhận thay đổi');
    expect(text).not.toContain('quyền.T');
  });

  it('only removing a user', async () => {
    await confirmFor(role({}), () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Người dùng' }));
      fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi vai trò an' }));
    });
    const text = await lines();
    expect(text).toContain('Gỡ người dùng: 1.');
    expect(text).toContain('Tổng số người dùng sau khi lưu: 0.');
    expect(text).toContain('Người dùng bị gỡ không còn nhận quyền từ vai trò này');
    expect(text).toContain('Quyền từ các vai trò khác không thay đổi.');
  });

  it('only changing permissions', async () => {
    await confirmFor(role({}), addPermission);
    const text = await lines();
    expect(text).toContain('Thêm 1 và gỡ 0 quyền.');
    expect(text).toContain('1 người dùng còn trong vai trò nhận thay đổi quyền');
    expect(text).not.toContain('Thêm người dùng');
  });

  it('users and permissions together, without double counting', async () => {
    await confirmFor(role({}), async () => { addPermission(); await addTwoUsers(); });
    const text = await lines();
    expect(text).toContain('Thêm người dùng: 2.');
    expect(text).toContain('Thêm 1 và gỡ 0 quyền.');
    expect(text).toContain('Tổng số người dùng sau khi lưu: 3.');
    expect(text).toContain('1 người dùng còn trong vai trò nhận thay đổi quyền');
  });

  it('an inactive role grants nothing yet', async () => {
    await confirmFor(role({ isActive: false }), async () => { addPermission(); await addTwoUsers(); });
    const text = await lines();
    expect(text).toContain('Vai trò đang ngừng hoạt động');
    expect(text).not.toContain('sẽ nhận các quyền');
  });

  it('only name or description: saves without a permission warning', async () => {
    const calls = serve({ ...baseRoutes(), 'GET /admin/roles/5': () => [200, role({})], 'PUT /admin/roles/5': () => [204] });
    wrap(<RolesPage initialId={5} />, '/roles/5?mode=edit');
    fireEvent.change(await screen.findByLabelText(/Tên vai trò/), { target: { value: 'Sales mới' } });
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu vai trò' }));
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true));
    expect(screen.queryByText(/Lưu thay đổi vai trò/)).toBeNull();
  });
});
