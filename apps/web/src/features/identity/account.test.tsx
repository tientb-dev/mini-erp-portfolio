import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { api, PASSWORD_CHANGE_REQUIRED, SESSION_ENDED, token } from '../../services/api-client';
import { AccountMenu, ChangePasswordDialog, ForcePasswordChange } from './account';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const me = { id: 7, username: 'nguyen.an', fullName: 'Nguyễn Văn An', permissions: [], warehouseIds: [], roleCodes: ['SALES'] };

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('Change password', () => {
  it('validates length, reuse and confirmation before calling the API', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    wrap(<ChangePasswordDialog onClose={() => {}} onChanged={() => {}} />);
    const submit = screen.getAllByRole('button', { name: 'Đổi mật khẩu' }).at(-1)!;
    type(/Mật khẩu hiện tại/, 'current passphrase');
    type(/^Mật khẩu mới/, 'short');
    expect(screen.getByText(/cần từ 12 đến 256 ký tự/)).toBeTruthy();
    type(/^Mật khẩu mới/, 'current passphrase');
    expect(screen.getByText(/phải khác mật khẩu hiện tại/)).toBeTruthy();
    type(/^Mật khẩu mới/, 'a brand new passphrase');
    type(/Xác nhận/, 'something else entirely');
    expect(screen.getByText(/chưa khớp/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('toggles password visibility', () => {
    wrap(<ChangePasswordDialog onClose={() => {}} onChanged={() => {}} />);
    const field = screen.getByLabelText(/Mật khẩu hiện tại/) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.click(screen.getAllByRole('button', { name: 'Hiện mật khẩu' })[0]!);
    expect(field.type).toBe('text');
  });

  it('sends only current and new password, then reports success without a token', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const onChanged = vi.fn();
    wrap(<ChangePasswordDialog onClose={() => {}} onChanged={onChanged} />);
    type(/Mật khẩu hiện tại/, 'current passphrase');
    type(/^Mật khẩu mới/, 'a brand new passphrase');
    type(/Xác nhận/, 'a brand new passphrase');
    fireEvent.click(screen.getAllByRole('button', { name: 'Đổi mật khẩu' }).at(-1)!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/auth\/change-password$/);
    expect(JSON.parse(String(init!.body))).toEqual({ currentPassword: 'current passphrase', newPassword: 'a brand new passphrase' });
  });

  it('shows the API reason when the current password is wrong', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'INVALID_CURRENT_PASSWORD', detail: 'x' }), { status: 422 }));
    const onChanged = vi.fn();
    wrap(<ForcePasswordChange me={me} onChanged={onChanged} onLogout={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Đổi mật khẩu để tiếp tục' })).toBeTruthy();
    type(/Mật khẩu hiện tại/, 'wrong current one');
    type(/^Mật khẩu mới/, 'a brand new passphrase');
    type(/Xác nhận/, 'a brand new passphrase');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(await screen.findByText(/Mật khẩu hiện tại không đúng/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('Account menu', () => {
  it('shows initials, name and username, and offers profile, change password and sign out', async () => {
    const onLogout = vi.fn();
    wrap(<AccountMenu me={me} onLogout={onLogout} onPasswordChanged={() => {}} />);
    expect(screen.getByText('NA')).toBeTruthy();
    expect(screen.getByText('nguyen.an')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hồ sơ cá nhân' }));
    expect(screen.getByText('SALES')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đóng' }).at(-1)!);
    await waitFor(() => expect(screen.queryByText('SALES')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đăng xuất' }));
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('Session signals', () => {
  it('ends the session on 401 and flags a required password change on 403', async () => {
    const ended = vi.fn(), required = vi.fn();
    window.addEventListener(SESSION_ENDED, ended);
    window.addEventListener(PASSWORD_CHANGE_REQUIRED, required);
    try {
      token.set('t');
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PASSWORD_CHANGE_REQUIRED' }), { status: 403 }))
        .mockResolvedValueOnce(new Response('{}', { status: 401 }))
        .mockResolvedValueOnce(new Response('{}', { status: 401 }));
      await expect(api('/products')).rejects.toThrow();
      expect(required).toHaveBeenCalledTimes(1);
      await expect(api('/products')).rejects.toThrow();
      expect(token.get()).toBeNull();
      expect(ended).toHaveBeenCalledTimes(1);
      // A failed sign-in (no token) does not raise another end-of-session signal.
      await expect(api('/auth/login', { method: 'POST' })).rejects.toThrow();
      expect(ended).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SESSION_ENDED, ended);
      window.removeEventListener(PASSWORD_CHANGE_REQUIRED, required);
    }
  });
});
