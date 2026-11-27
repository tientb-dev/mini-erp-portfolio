import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { wrap } from '../../test/helpers/api';
import { JobTitlesPage } from './JobTitlesPage';

const lead = { id: 3, code: 'TP', name: 'Trưởng phòng', description: 'Quản lý phòng', isActive: true, version: 2 };
const staff = { id: 4, code: 'NV', name: 'Nhân viên', description: null, isActive: false, version: 1 };
const me = (permissions: string[]) => ({ id: 1, username: 'admin', permissions, warehouseIds: [] });

type Call = { method: string; url: string; body: unknown };
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
const base = (permissions = ['ORGANIZATION.VIEW', 'ORGANIZATION.MANAGE']) => ({
  'GET /auth/me': () => [200, me(permissions)] as [number, unknown],
  'GET /admin/job-titles?': () => [200, { items: [lead, staff], total: 2 }] as [number, unknown],
});

afterEach(() => vi.restoreAllMocks());

describe('Job titles', () => {
  it('lists server rows and sends search, status, sort and page', async () => {
    const calls = serve(base());
    wrap(<JobTitlesPage />, '/job-titles?q=tp&status=true&sort=name&direction=desc&size=50&page=1');
    expect(await screen.findByRole('link', { name: 'TP' })).toBeTruthy();
    expect(screen.getByText('Quản lý phòng')).toBeTruthy();
    expect(Object.fromEntries(new URL('http://x' + calls.find(c => c.url.startsWith('/admin/job-titles?'))!.url).searchParams))
      .toEqual({ q: 'tp', status: 'true', sort: 'name', direction: 'desc', page: '1', size: '50' });
    expect(screen.getByRole('button', { name: 'Sao chép tạo mới TP' })).toBeTruthy();
  });

  it('hides actions and switches without ORGANIZATION.MANAGE', async () => {
    serve(base(['ORGANIZATION.VIEW']));
    wrap(<JobTitlesPage />, '/job-titles');
    expect(await screen.findByRole('link', { name: 'TP' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm chức danh' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa TP' })).toBeNull();
  });

  it('copies with an empty code, prefilled name and description, active status, and records the source', async () => {
    const calls = serve({ ...base(), 'GET /admin/job-titles/3': () => [200, lead], 'POST /admin/job-titles': () => [201, { id: 9 }] });
    wrap(<JobTitlesPage initialId={0} />, '/job-titles/new?copy=3');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect((within(dialog).getByLabelText(/Tên chức danh/) as HTMLInputElement).value).toBe('Trưởng phòng'));
    expect((within(dialog).getByLabelText(/Mã chức danh/) as HTMLInputElement).value).toBe('');
    expect(within(dialog).getByText('Đang dùng')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Mã chức danh/), { target: { value: 'TP2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm mới' }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body)
      .toEqual({ code: 'TP2', name: 'Trưởng phòng', description: 'Quản lý phòng', copiedFrom: 3 }));
  });

  it('shows a duplicate code inline instead of a result dialog', async () => {
    serve({ ...base(), 'POST /admin/job-titles': () => [409, { code: 'DUPLICATE_VALUE', detail: 'dup' }] });
    wrap(<JobTitlesPage initialId={0} />, '/job-titles/new');
    const dialog = await screen.findByRole('dialog');
    const add = await within(dialog).findByRole('button', { name: 'Thêm mới' });
    fireEvent.change(within(dialog).getByLabelText(/Mã chức danh/), { target: { value: 'TP' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên chức danh/), { target: { value: 'X' } });
    fireEvent.click(add);
    expect(await within(dialog).findByText('Giá trị này đã tồn tại.')).toBeTruthy();
  });

  it('edits name and description with the version while the code stays read-only', async () => {
    const calls = serve({ ...base(), 'GET /admin/job-titles/3': () => [200, lead], 'PUT /admin/job-titles/3': () => [204] });
    wrap(<JobTitlesPage initialId={3} />, '/job-titles/3?mode=edit');
    const dialog = await screen.findByRole('dialog');
    const saveButton = await within(dialog).findByRole('button', { name: 'Lưu thay đổi' });
    const name = within(dialog).getByLabelText(/Tên chức danh/);
    expect((within(dialog).getByLabelText('Mã chức danh') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(name, { target: { value: 'Trưởng ban' } });
    fireEvent.click(saveButton);
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')?.body).toEqual({ name: 'Trưởng ban', description: 'Quản lý phòng', version: 2 }));
  });

  it('asks before deactivating and sends the row version; activation is direct', async () => {
    const calls = serve({ ...base(), 'PATCH /admin/job-titles/': () => [204] });
    wrap(<JobTitlesPage />, '/job-titles');
    fireEvent.click(await screen.findByRole('switch', { name: 'Trạng thái TP' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Xác nhận ngừng sử dụng')).toBeTruthy();
    expect(within(confirm).getByText('TP · Trưởng phòng')).toBeTruthy();
    expect(within(confirm).getByRole('button', { name: 'Ngừng sử dụng' }).className).toMatch(/colorError/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Ngừng sử dụng' }));
    await waitFor(() => expect(calls.find(c => c.url === '/admin/job-titles/3/status')?.body).toEqual({ isActive: false, version: 2 }));
  });
});
