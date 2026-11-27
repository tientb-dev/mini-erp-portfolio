import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { token } from '../services/api-client';
import { App } from './App';

/**
 * F-OA1.3-20: effective permissions in the real App + AppShell + router + identity query. The backend decides; the UI
 * follows /auth/me, re-read after a business 403, on window focus and after saving a role.
 */
const roleList = { total: 1, items: [{ id: 5, code: 'SALES', name: 'Sales', description: null, isActive: true, isSystem: false, userCount: 1, permissionCount: 2 }] };

function backend(initial: string[]) {
  const state = { permissions: initial, meCalls: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (path === '/auth/me') {
      state.meCalls++;
      return json(200, { id: 1, username: 'qt', fullName: 'Quản Trị', permissions: state.permissions, warehouseIds: [], mustChangePassword: false });
    }
    if (path === '/admin/roles') return state.permissions.includes('ROLE.VIEW') ? json(200, roleList) : json(403, { code: 'FORBIDDEN', detail: 'Missing permission' });
    return json(200, []);
  });
  return state;
}

function renderApp(url: string) {
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [url] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
const nav = () => screen.getByRole('navigation', { name: 'Điều hướng chính' });

// A desktop viewport, so AppShell renders the permanent sidebar.
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); window.matchMedia = realMatchMedia; });

describe('Effective permissions in the running app', () => {
  it('follows revoked permissions: focus refresh hides actions, a 403 hides the menu and the route, the session stays', async () => {
    token.set('t1');
    const state = backend(['ROLE.VIEW', 'ROLE.MANAGE']);
    renderApp('/roles');
    expect(await screen.findByRole('link', { name: 'SALES' })).toBeTruthy();
    expect(within(nav()).getByRole('link', { name: 'Vai trò & Phân quyền' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thêm vai trò' })).toBeTruthy();

    // ROLE.MANAGE revoked elsewhere: the window regains focus and the identity is read again.
    state.permissions = ['ROLE.VIEW'];
    await act(async () => { window.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Thêm vai trò' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Sửa SALES' })).toBeNull();
    expect(within(nav()).getByRole('link', { name: 'Vai trò & Phân quyền' })).toBeTruthy();

    // ROLE.VIEW revoked too: the next call is refused (403); the app re-reads /auth/me instead of signing out.
    state.permissions = [];
    const meBefore = state.meCalls;
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Vai trò & Phân quyền' })).toBeNull());
    expect(await screen.findByText('Không tìm thấy trang hoặc bạn không có quyền truy cập.')).toBeTruthy();
    expect(token.get()).toBe('t1');
    expect(screen.queryByRole('heading', { name: 'Đăng nhập' })).toBeNull();
    // No request or redirect loop.
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(state.meCalls - meBefore).toBeLessThanOrEqual(2);
  });

  it('uses the new permissions after a role save without signing in again', async () => {
    token.set('t1');
    const state = backend(['ROLE.VIEW', 'ROLE.MANAGE']);
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });
      if (path === '/auth/me') { state.meCalls++; return json(200, { id: 1, username: 'qt', permissions: state.permissions, warehouseIds: [] }); }
      if (path === '/admin/permissions') return json(200, [{ code: 'PO.VIEW', module: 'PO', name: 'Xem đơn mua hàng', description: null, adminOnly: false }]);
      if (path === '/admin/roles/5' && init?.method === 'PUT') { state.permissions = ['ROLE.VIEW', 'ROLE.MANAGE', 'PO.VIEW']; return json(204, null); }
      if (path === '/admin/roles/5') return json(200, { id: 5, code: 'SALES', name: 'Sales', description: null, isActive: true, isSystem: false, version: 1,
        permissions: [], users: [{ id: 1, username: 'qt', fullName: 'Quản Trị', isActive: true }], history: [], historyCursor: null });
      if (path === '/admin/roles') return json(200, roleList);
      return json(200, []);
    });
    renderApp('/roles/5?mode=edit');
    fireEvent.click(await screen.findByRole('tab', { name: 'Phân quyền' }));
    expect(within(nav()).queryByRole('link', { name: 'Đơn đặt hàng (PO)' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Xem đơn mua hàng (PO.VIEW)' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Thao tác quyết định' })).getByRole('button', { name: 'Lưu vai trò' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lưu vai trò' }));
    // The result dialog is modal (the sidebar is aria-hidden behind it): query the sidebar including hidden elements.
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Điều hướng chính', hidden: true }))
      .getByRole('link', { name: 'Đơn đặt hàng (PO)', hidden: true })).toBeTruthy());
    expect(token.get()).toBe('t1');
  });
});
