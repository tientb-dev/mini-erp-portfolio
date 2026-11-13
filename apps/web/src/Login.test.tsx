import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import './i18n';
import { Login } from './Login';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Login', () => {
  it('renders Vietnamese labels by default', () => {
    render(<Login onLoggedIn={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
  });

  it('stores the token and calls onLoggedIn on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accessToken: 'abc' }), { status: 200 }));
    const onLoggedIn = vi.fn();
    render(<Login onLoggedIn={onLoggedIn} />);
    fireEvent.change(screen.getByLabelText(/Tên đăng nhập/), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(sessionStorage.getItem('mini-erp-token')).toBe('abc');
  });

  it('shows an error on bad credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }));
    render(<Login onLoggedIn={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Tên đăng nhập/), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText(/Sai tên đăng nhập hoặc mật khẩu/)).toBeTruthy();
  });
});
