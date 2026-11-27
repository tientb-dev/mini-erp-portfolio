import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, PERMISSION_DENIED, SESSION_ENDED, token } from '../services/api-client';
import { App } from './App';

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const forcedMe = { id: 3, username: 'an', fullName: 'Nguyễn An', permissions: [], warehouseIds: [], mustChangePassword: true };
/** Routes fetch by path; unknown paths fail loudly. */
function serve(routes: Record<string, () => Promise<Response> | Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const route = routes[path];
    if (!route) throw new Error(`unexpected ${path}`);
    return route();
  });
}
const renderApp = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('Authentication state', () => {
  it('a refresh during a required password change shows only that screen', async () => {
    token.set('t1');
    serve({ '/auth/me': () => json(200, forcedMe) });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Đổi mật khẩu để tiếp tục' })).toBeTruthy();
    expect(screen.queryByText('Mini ERP', { selector: 'span' })).toBeNull();
  });

  it('an invalid session returns to Login with one neutral notice', async () => {
    token.set('t1');
    serve({ '/auth/me': () => json(401, { code: 'UNAUTHORIZED' }) });
    renderApp();
    expect(await screen.findByText('Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại để tiếp tục.')).toBeTruthy();
    expect(screen.getAllByText(/Phiên đăng nhập không còn hiệu lực/)).toHaveLength(1);
    expect(token.get()).toBeNull();
  });

  it('a confirmed sign-out shows no notice; an unconfirmed one says the server did not confirm it', async () => {
    token.set('t1');
    serve({ '/auth/me': () => json(200, forcedMe), '/auth/logout': () => json(204, null) });
    const view = renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();
    vi.restoreAllMocks();

    token.set('t2');
    serve({ '/auth/me': () => json(200, forcedMe), '/auth/logout': () => Promise.reject(new TypeError('Failed to fetch')) });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText(/chưa xác nhận được với máy chủ/)).toBeTruthy();
    expect(screen.queryByText(/Phiên đăng nhập không còn hiệu lực/)).toBeNull();
    expect(token.get()).toBeNull();
  });

  it('a late 401 from an old session does not end the new session', async () => {
    let release!: (r: Response) => void;
    token.set('old');
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const ended = vi.fn();
    window.addEventListener(SESSION_ENDED, ended);
    try {
      const stale = api('/products').catch(() => undefined);
      token.set('new');
      release(json(401, {}));
      await stale;
      expect(token.get()).toBe('new');
      expect(ended).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(SESSION_ENDED, ended);
    }
  });

  it('a business 403 re-reads /auth/me without signing out (F-OA1.3-12)', async () => {
    token.set('t1');
    let meCalls = 0;
    serve({ '/auth/me': () => { meCalls++; return json(200, { ...forcedMe, mustChangePassword: false, permissions: [] }); },
      '/products': () => json(403, { code: 'FORBIDDEN' }) });
    const denied = vi.fn();
    window.addEventListener(PERMISSION_DENIED, denied);
    try {
      await expect(api('/products')).rejects.toThrow();
      expect(denied).toHaveBeenCalledTimes(1);
      expect(token.get()).toBe('t1');
    } finally {
      window.removeEventListener(PERMISSION_DENIED, denied);
    }
    expect(meCalls).toBe(0);
  });

  it('concurrent 401s end the session once', async () => {
    token.set('t1');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(401, {}));
    const ended = vi.fn();
    window.addEventListener(SESSION_ENDED, ended);
    try {
      await Promise.all([api('/a'), api('/b'), api('/c')].map(p => p.catch(() => undefined)));
      await waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener(SESSION_ENDED, ended);
    }
  });

  it('Login offers show/hide, the admin contact hint and the uniform error', async () => {
    serve({ '/auth/login': () => json(401, { code: 'INVALID_CREDENTIALS' }) });
    renderApp();
    expect(screen.getByText('Hệ thống quản lý doanh nghiệp')).toBeTruthy();
    expect(screen.getByText('Quên mật khẩu? Liên hệ quản trị viên.')).toBeTruthy();
    const password = screen.getByLabelText(/Mật khẩu/) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(password.type).toBe('text');
    fireEvent.change(screen.getByLabelText(/Tên đăng nhập/), { target: { value: 'x' } });
    fireEvent.change(password, { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText(/Sai tên đăng nhập hoặc mật khẩu/)).toBeTruthy();
    expect(screen.queryByText(/Phiên đăng nhập không còn hiệu lực/)).toBeNull();
  });
});
