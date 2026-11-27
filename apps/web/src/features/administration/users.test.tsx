import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { wrap } from '../../test/helpers/api';
import { UsersPage } from './UsersPage';
import { OrgUnitsPage } from './OrgUnitsPage';
import { applyMembership } from './UserRelationTabs';

const KD = { id: 2, code: 'KD', name: 'Kinh doanh' };
const KT = { id: 3, code: 'KT', name: 'Kế toán' };
const NV = { id: 4, code: 'NV', name: 'Nhân viên' };
const an = {
  id: 7, employeeCode: 'E07', fullName: 'Nguyễn An', email: 'an@x.vn', phone: null, employmentStatus: 'ACTIVE', username: 'an', accountStatus: 'LOCKED',
  version: 5, primaryOrgUnit: KD, primaryJobTitle: NV, accountActive: true, mustChangePassword: false, lockedUntil: '2026-11-27T05:00:00Z', updatedAt: '2026-11-27T01:00:00Z',
  roles: [{ id: 2, code: 'SALES', name: 'Sales', isActive: true }], warehouses: [],
  memberships: [{ id: 11, orgUnit: KD, jobTitle: NV, isPrimary: true, manager: null, isHead: false, startedAt: '2026-11-01T00:00:00Z', version: 1 }],
};
const me = { id: 1, username: 'admin', permissions: ['USER.VIEW', 'USER.MANAGE', 'ORGANIZATION.VIEW', 'ORGANIZATION.MANAGE', 'ROLE.VIEW', 'WAREHOUSE.VIEW'], warehouseIds: [] };

type Call = { method: string; url: string; body: Record<string, unknown> };
function serve(overrides: Record<string, (url: string) => [number, unknown?]> = {}) {
  const routes: Record<string, (url: string) => [number, unknown?]> = {
    'GET /auth/me': () => [200, me],
    'GET /admin/users?': () => [200, { items: [an], total: 1 }],
    'GET /admin/users/7/history': () => [200, { items: [], nextCursor: null }],
    'GET /admin/users/7': () => [200, an],
    'GET /admin/org-units/tree': () => [200, [{ ...KD, parentId: null, isActive: true, version: 1, memberCount: 1 }, { ...KT, parentId: null, isActive: true, version: 1, memberCount: 0 }]],
    'GET /admin/job-titles?': () => [200, { items: [{ ...NV, isActive: true }], total: 1 }],
    'GET /admin/roles?': () => [200, { items: [{ id: 2, code: 'SALES', name: 'Sales', isActive: true }, { id: 3, code: 'PM', name: 'PM', isActive: true }], total: 2 }],
    'GET /warehouses': () => [200, [{ id: 1, code: 'HN', name: 'Hà Nội', isActive: true }]],
    'POST /admin/users': () => [201, { id: 9 }],
    'PUT /admin/users/7': () => [204],
    'POST /admin/users/7/unlock': () => [204],
    ...overrides,
  };
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const key = Object.keys(routes).filter(k => { const [m, p] = k.split(' '); return m === method && url.startsWith(p!); }).sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unexpected ${method} ${url}`);
    const [status, payload] = routes[key]!(url);
    return new Response(status === 204 ? null : JSON.stringify(payload ?? {}), { status });
  });
  return calls;
}
const footer = () => screen.getByRole('region', { name: 'Thao tác quyết định' });

afterEach(() => vi.restoreAllMocks());

describe('applyMembership', () => {
  it('keeps one row per unit and moves the primary to the marked unit', () => {
    const list = [an.memberships[0]!];
    const next = applyMembership(list, { orgUnit: KT, jobTitle: NV, manager: null, isPrimary: true });
    expect(next.map(m => [m.orgUnit.code, m.isPrimary])).toEqual([['KD', false], ['KT', true]]);
    expect(applyMembership(next, { orgUnit: KT, jobTitle: NV, manager: null, isPrimary: true }, KT.id)).toHaveLength(2);
  });
});

describe('Users list', () => {
  it('shows employment and account statuses separately and sends filters, sort and page to the server', async () => {
    const calls = serve();
    wrap(<UsersPage />, '/users?q=an&accountStatus=LOCKED&orgUnitId=2&sort=fullName&direction=desc');
    expect(await screen.findByRole('link', { name: 'E07' })).toBeTruthy();
    expect(screen.getByText('Đang làm việc')).toBeTruthy();
    expect(screen.getAllByText('Khóa tạm thời').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KD · Kinh doanh').length).toBeGreaterThan(0);
    expect(Object.fromEntries(new URL('http://x' + calls.find(c => c.url.startsWith('/admin/users?'))!.url).searchParams))
      .toMatchObject({ q: 'an', accountStatus: 'LOCKED', orgUnitId: '2', sort: 'fullName', direction: 'desc', page: '0' });
    expect(screen.getByRole('button', { name: 'Chỉnh sửa E07' })).toBeTruthy();
  });
});

describe('User detail', () => {
  it('creates an employee with account and roles in one request', async () => {
    const calls = serve();
    wrap(<UsersPage initialId={0} />, '/users/new');
    fireEvent.click(within(await screen.findByRole('region', { name: 'Thao tác quyết định' })).getByRole('button', { name: 'Lưu' }));
    expect((await screen.findByLabelText(/Mã nhân viên/)).getAttribute('aria-invalid')).toBe('true');
    expect(calls.some(c => c.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText(/Mã nhân viên/), { target: { value: 'E09' } });
    fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'Trần Bình' } });
    fireEvent.click(screen.getByLabelText('Tạo tài khoản đăng nhập cùng nhân sự'));
    fireEvent.change(screen.getByLabelText(/Tên đăng nhập/), { target: { value: 'binh' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu khởi tạo/), { target: { value: 'mot-cum-tu-dai' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Vai trò' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vai trò' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'PM · PM' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm vào danh sách' }));
    // Switching tabs keeps the typed profile (one draft for every tab).
    fireEvent.click(screen.getByRole('tab', { name: 'Thông tin chung' }));
    expect((screen.getByLabelText(/Họ tên/) as HTMLInputElement).value).toBe('Trần Bình');
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({
      profile: { employeeCode: 'E09', fullName: 'Trần Bình', email: null, phone: null },
      account: { username: 'binh', initialPassword: 'mot-cum-tu-dai' }, memberships: [], roleIds: [3], warehouseIds: [] }));
  });

  it('edits, confirms the permission change and sends only the changed lists with the version', async () => {
    const calls = serve();
    wrap(<UsersPage initialId={7} />, '/users/7?mode=edit');
    fireEvent.change(await screen.findByLabelText(/Họ tên/), { target: { value: 'Nguyễn Văn An' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Vai trò' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ vai trò SALES' }));
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Gỡ vai trò: SALES.')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')?.body).toEqual({
      profile: { fullName: 'Nguyễn Văn An', email: 'an@x.vn', phone: null }, roleIds: [], version: 5 }));
    expect(await screen.findByText('Đã lưu người dùng')).toBeTruthy();
  });

  it('keeps the draft on 409 VERSION_CONFLICT and explains it', async () => {
    serve({ 'PUT /admin/users/7': () => [409, { code: 'VERSION_CONFLICT', detail: 'changed' }] });
    wrap(<UsersPage initialId={7} />, '/users/7?mode=edit');
    fireEvent.change(await screen.findByLabelText(/Họ tên/), { target: { value: 'An mới' } });
    fireEvent.click(within(footer()).getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Lưu người dùng không thành công')).toBeTruthy();
    expect(screen.getByText(/Dữ liệu bạn nhập vẫn được giữ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    expect((screen.getByLabelText(/Họ tên/) as HTMLInputElement).value).toBe('An mới');
  });

  it('unlocks the account with its own confirmation and the employee version', async () => {
    const calls = serve();
    wrap(<UsersPage initialId={7} />, '/users/7');
    fireEvent.click(await screen.findByRole('button', { name: 'Mở khóa' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mở khóa' }));
    await waitFor(() => expect(calls.find(c => c.url === '/admin/users/7/unlock')?.body).toEqual({ version: 5 }));
    expect(await screen.findByText('Đã mở khóa tài khoản')).toBeTruthy();
  });

  it('hides management for a viewer and shows View read-only', async () => {
    serve({ 'GET /auth/me': () => [200, { ...me, permissions: ['USER.VIEW'] }] });
    wrap(<UsersPage initialId={7} />, '/users/7');
    expect((await screen.findByLabelText('Họ tên') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole('region', { name: 'Thao tác quyết định' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở khóa' })).toBeNull();
  });
});

describe('Organization Nhân sự tab', () => {
  it('lists members, shows the member count and ends a membership through the Membership API', async () => {
    const calls = serve({
      'GET /admin/org-units/2/members': () => [200, [{ id: 7, employeeCode: 'E07', fullName: 'Nguyễn An', employmentStatus: 'ACTIVE', isPrimary: true,
        startedAt: '2026-11-01T00:00:00Z', isHead: false, jobTitle: NV, manager: null, membershipId: 11, membershipVersion: 1 }]],
      'GET /admin/org-units/2/history': () => [200, { items: [], nextCursor: null }],
      'GET /admin/org-units/2': () => [200, { ...KD, description: null, isActive: true, version: 1, parent: null, headUserId: null, head: null }],
      'POST /admin/memberships/11/end': () => [204],
    });
    wrap(<OrgUnitsPage initialId={2} />, '/org-units/2');
    expect(await screen.findByText('1 nhân sự')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Ngừng/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Nhân sự (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kết thúc phân công E07' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kết thúc phân công' }));
    await waitFor(() => expect(calls.find(c => c.url === '/admin/memberships/11/end')?.body).toEqual({ version: 1 }));
    // F11: id and version come from the members list; the employee record is not fetched.
    expect(calls.some(c => c.url === '/admin/users/7')).toBe(false);
  });
});

describe('OA2.3c closure', () => {
  const roles = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, code: `R${String(i + 1).padStart(3, '0')}`, name: `Vai trò ${i + 1}`, isActive: true }));
  const rolePage = (url: string): [number, unknown] => {
    const p = new URL('http://x' + url).searchParams;
    const q = (p.get('q') ?? '').toLowerCase();
    const all = roles.filter(r => !q || r.code.toLowerCase().includes(q));
    const size = Number(p.get('size')), page = Number(p.get('page'));
    return [200, { items: all.slice(page * size, page * size + size), total: all.length }];
  };

  it('F05: the role picker pages on the server past 100 roles and keeps the selection across pages and search', { timeout: 15_000 }, async () => {
    const calls = serve({ 'GET /admin/roles?': rolePage });
    wrap(<UsersPage initialId={7} />, '/users/7?mode=edit');
    fireEvent.click(await screen.findByRole('tab', { name: 'Vai trò' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vai trò' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'R003 · Vai trò 3' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /next page|trang sau/i }));
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'R026 · Vai trò 26' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'R12' } });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'R125 · Vai trò 125' }, { timeout: 4000 }));
    expect(within(dialog).getByText('Đã chọn 3')).toBeTruthy();
    expect(calls.some(c => c.url.includes('/admin/roles?') && c.url.includes('page=1'))).toBe(true);
    expect(calls.every(c => !c.url.includes('size=100'))).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm vào danh sách' }));
    expect(await screen.findByText('R125')).toBeTruthy();
    expect(screen.getByText('R003')).toBeTruthy();
  });

  it('F04: marking a secondary unit primary names the unit that becomes secondary', async () => {
    const withTwo = { ...an, memberships: [...an.memberships, { id: 12, orgUnit: KT, jobTitle: NV, isPrimary: false, manager: null, isHead: false, startedAt: '2026-11-02T00:00:00Z', version: 1 }] };
    serve({ 'GET /admin/users/7': () => [200, withTwo] });
    wrap(<UsersPage initialId={7} />, '/users/7?mode=edit');
    fireEvent.click(await screen.findByRole('tab', { name: 'Tổ chức' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa phân công KT' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Đơn vị chính' }));
    expect(within(dialog).getByText('Đơn vị chính hiện tại KD · Kinh doanh sẽ chuyển thành đơn vị kiêm nhiệm.')).toBeTruthy();
  });

  it('F07: history shows the granted username, times to the second and the automatic lock as the system', async () => {
    serve({ 'GET /admin/users/7/history': () => [200, { nextCursor: null, items: [
      { id: 2, action: 'ACCOUNT_LOCKED', createdAt: '2026-11-27T05:00:07Z', actorName: 'Nguyễn An', metadata: { minutes: 15 } },
      { id: 1, action: 'ACCOUNT_CREATED', createdAt: '2026-11-27T01:02:03Z', actorName: 'Admin', metadata: { username: 'an' } },
    ] }] });
    wrap(<UsersPage initialId={7} />, '/users/7');
    fireEvent.click(await screen.findByRole('tab', { name: 'Lịch sử' }));
    expect(await screen.findByText('Hệ thống (tự động, tài khoản Nguyễn An)')).toBeTruthy();
    expect(screen.getByText(/:07$/)).toBeTruthy();
    const created = screen.getByText('Cấp tài khoản').closest('tr')!;
    expect(within(created).getByText(/an$/).textContent).toContain('an');
    expect(within(created).getByText('Tên đăng nhập:')).toBeTruthy();
    expect(screen.queryByText(/password|hash/i)).toBeNull();
  });

  it('F08: Create keeps the account unchecked, shows the policy first and toggles the password visibility', async () => {
    serve();
    wrap(<UsersPage initialId={0} />, '/users/new');
    const box = await screen.findByLabelText('Tạo tài khoản đăng nhập cùng nhân sự') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(screen.getByText(/Tối thiểu 12 ký tự/)).toBeTruthy();
    const password = screen.getByLabelText(/Mật khẩu khởi tạo/) as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(password.type).toBe('text');
    fireEvent.change(password, { target: { value: 'ngan' } });
    fireEvent.click(within(await screen.findByRole('region', { name: 'Thao tác quyết định' })).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Mã nhân viên/)));
    expect(screen.getByText('Mật khẩu mới cần từ 12 đến 256 ký tự.')).toBeTruthy();
  });
});
