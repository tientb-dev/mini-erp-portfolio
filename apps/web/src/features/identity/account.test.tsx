import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { api, PASSWORD_CHANGE_REQUIRED, SESSION_ENDED, token } from '../../services/api-client';
import { AccountMenu, ChangePasswordDialog, ForcePasswordChange } from './account';
import { ProfileDialog } from './ProfileDialog';

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
    serveProfile();
    wrap(<AccountMenu me={me} onLogout={onLogout} onPasswordChanged={() => {}} />);
    expect(screen.getByText('NA')).toBeTruthy();
    expect(screen.getByText('nguyen.an')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hồ sơ cá nhân' }));
    expect(await screen.findByRole('tab', { name: 'Thông tin chung', selected: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Vai trò' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đăng xuất' }));
    expect(onLogout).toHaveBeenCalled();
  });
});

const profile = {
  id: 7, employeeCode: 'NV007', fullName: 'Nguyễn Văn An', email: 'an@x.vn', phone: null, employmentStatus: 'ACTIVE', username: 'nguyen.an',
  accountStatus: 'ACTIVE', version: 4, primaryOrgUnit: { id: 2, code: 'KD', name: 'Kinh doanh' }, primaryJobTitle: { id: 3, code: 'NV', name: 'Nhân viên' },
  memberships: [{ orgUnit: { id: 2, code: 'KD', name: 'Kinh doanh' }, jobTitle: { id: 3, code: 'NV', name: 'Nhân viên' }, isPrimary: true,
    manager: { id: 9, employeeCode: 'NV001', fullName: 'Trần Bình' }, isHead: true, startedAt: '2026-11-01T00:00:00Z' }],
  roles: [{ id: 2, code: 'SALES', name: 'Sales', isActive: true }],
};
function serveProfile(patch: [number, unknown?] = [204]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'PATCH') return new Response(patch[0] === 204 ? null : JSON.stringify(patch[1]), { status: patch[0] });
    return new Response(JSON.stringify(profile), { status: 200 });
  });
  return calls;
}

describe('Personal profile', () => {
  it('F01–F03: three tabs, General first; only email/phone editable; one hint; head column in Organization', async () => {
    serveProfile();
    wrap(<ProfileDialog onClose={() => {}} />);
    expect(await screen.findByRole('tab', { name: 'Thông tin chung', selected: true })).toBeTruthy();
    expect(screen.getByText('Bạn có thể cập nhật email và số điện thoại. Các thông tin khác do quản trị viên quản lý.')).toBeTruthy();
    // F02: no "code · name" line above the form, no name helper.
    expect(screen.queryByText('NV007 · Nguyễn Văn An')).toBeNull();
    expect((screen.getByLabelText('Họ tên') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Mã nhân viên') as HTMLInputElement).readOnly).toBe(true);
    // Switching tabs keeps the input (one draft).
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'giu@x.vn' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Tổ chức' }));
    expect(await screen.findByText('NV001 · Trần Bình')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Trưởng đơn vị' })).toBeTruthy();
    expect(screen.getByTitle('Trưởng đơn vị')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Vai trò' }));
    expect(screen.getByText('SALES · Sales')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Thông tin chung' }));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('giu@x.vn');
  });

  it('F04: Save only when changed; validation stays inline; saves email/phone with the version, then closes after the result', async () => {
    const calls = serveProfile();
    const onClose = vi.fn();
    wrap(<ProfileDialog onClose={onClose} />);
    await screen.findByLabelText('Email');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sai' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText('Email chưa đúng định dạng.')).toBeTruthy();
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'moi@x.vn' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901 222 333' } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.find(c => c.method === 'PATCH')).toEqual({ method: 'PATCH', url: '/me', body: { email: 'moi@x.vn', phone: '0901 222 333', version: 4 } }));
    expect(await screen.findByText('Đã lưu hồ sơ cá nhân')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 4000 });
  });

  it('F04: closing with unsaved changes asks first (X, Escape, Hủy bỏ)', async () => {
    serveProfile();
    const onClose = vi.fn();
    wrap(<ProfileDialog onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText('Số điện thoại'), { target: { value: '0909' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));
    expect(await screen.findByText('Bỏ thay đổi chưa lưu?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục sửa' }));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Số điện thoại') as HTMLInputElement).value).toBe('0909');
    fireEvent.keyDown(screen.getAllByRole('dialog')[0]!, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ thay đổi' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('F04: keeps the input on 409 VERSION_CONFLICT without retrying', async () => {
    const calls = serveProfile([409, { code: 'VERSION_CONFLICT', detail: 'changed' }]);
    const onClose = vi.fn();
    wrap(<ProfileDialog onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText('Số điện thoại'), { target: { value: '0909' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/Dữ liệu bạn nhập vẫn được giữ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    expect((screen.getByLabelText('Số điện thoại') as HTMLInputElement).value).toBe('0909');
    expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(1);
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('F04: each opening reads the latest profile', async () => {
    const calls = serveProfile();
    const client = new QueryClient();
    const view = (ui: ReactNode) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
    const { rerender } = render(view(<ProfileDialog key={1} onClose={() => {}} />));
    await screen.findByLabelText('Email');
    rerender(view(<span />));
    rerender(view(<ProfileDialog key={2} onClose={() => {}} />));
    await waitFor(() => expect(calls.filter(c => c.url === '/me')).toHaveLength(2));
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
