import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DossierTypesPage } from '../master-data';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { DossierConfigurationPage, DossierConfigurationsPage } from './DossierConfigurationPage';

const quote = { id: 1, code: 'QUOTE', name: 'Báo giá', isActive: true };
const spec = { id: 2, code: 'SPEC', name: 'Thông số', isActive: true };
const invoice = { id: 3, code: 'INVOICE', name: 'Hóa đơn', isActive: true };
const inactive = { id: 4, code: 'OLD', name: 'Đã lưu', isActive: false };

it('opens the common catalog View and Edit popup with a dirty guard', async () => {
  mockApi({ '/auth/me': me(['DOSSIER_TYPE.VIEW', 'DOSSIER_TYPE.MANAGE']), '/dossier-types': [quote, inactive] });
  wrap(<DossierTypesPage initialId={1} />, '/dossier-types/1');
  const dialog = within(await screen.findByRole('dialog'));
  expect((dialog.getByRole<HTMLInputElement>('textbox', { name: /Mã loại hồ sơ/ })).value).toBe('QUOTE');
  fireEvent.click(dialog.getByRole('button', { name: /Chỉnh sửa|Sửa/ }));
  expect(dialog.getByRole<HTMLInputElement>('textbox', { name: /Tên loại hồ sơ/ }).readOnly).toBe(false);
  fireEvent.change(dialog.getByRole('textbox', { name: /Tên loại hồ sơ/ }), { target: { value: 'Updated' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Hủy bỏ' }));
  expect(await screen.findByText('Bỏ thay đổi chưa lưu?')).toBeTruthy();
});

it('filters, refreshes and changes dossier type status through the common catalog', async () => {
  const posts = mockApi({
    '/auth/me': me(['DOSSIER_TYPE.VIEW', 'DOSSIER_TYPE.MANAGE']), '/dossier-types': [quote, inactive],
  });
  wrap(<DossierTypesPage />, '/dossier-types?status=false');
  expect(await screen.findByRole('switch', { name: 'Trạng thái OLD' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'QUOTE' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  expect(await screen.findByRole('link', { name: 'QUOTE' })).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: 'Trạng thái OLD' }));
  await waitFor(() => expect(posts).toEqual([{ url: '/dossier-types/4/status', body: { isActive: true } }]));
  expect(await screen.findByRole('dialog')).toBeTruthy();
});

it('lists document kinds with a direct configuration link', async () => {
  mockApi({ '/dossier-configurations': [{ documentType: 'PR', count: 2 }, { documentType: 'SALES_CONTRACT', count: 0 }] });
  wrap(<DossierConfigurationsPage />, '/dossier-configurations');
  expect((await screen.findByRole('link', { name: 'PR' })).getAttribute('href')).toBe('/dossier-configurations/PR');
  expect(screen.getByRole('link', { name: 'SC' }).getAttribute('href')).toBe('/dossier-configurations/SALES_CONTRACT');
});

it('keeps picks through search, edits locally, and retains an unsaved configuration after a conflict', async () => {
  const calls: unknown[] = [];
  let fail = true;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, options) => {
    if (options?.method === 'PUT') {
      calls.push(JSON.parse(String(options.body)));
      if (fail) return new Response(JSON.stringify({ code: 'STALE_VERSION', detail: 'Version changed' }), { status: 409 });
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(String(request).endsWith('/catalog')
      ? [quote, spec, invoice, inactive] : { version: 7, items: [quote, inactive] }), { status: 200 });
  });
  wrap(<DossierConfigurationPage documentType="PR" />, '/dossier-configurations/PR');
  const save = await screen.findByRole<HTMLButtonElement>('button', { name: 'Lưu cấu hình' });
  expect(save.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Di chuyển lên QUOTE' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm loại hồ sơ' }));
  const picker = within(await screen.findByRole('dialog'));
  expect(picker.getByRole<HTMLButtonElement>('button', { name: 'Xác nhận (0)' }).disabled).toBe(true);
  fireEvent.click(await picker.findByRole('checkbox', { name: 'SPEC' }));
  expect(picker.queryByRole('checkbox', { name: 'QUOTE' })).toBeNull();
  expect(picker.queryByRole('checkbox', { name: 'OLD' })).toBeNull();
  fireEvent.change(picker.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'invoice' } });
  fireEvent.click(await picker.findByRole('checkbox', { name: 'INVOICE' }));
  fireEvent.click(picker.getByRole('button', { name: 'Xác nhận (2)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Di chuyển lên SPEC' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xóa khỏi cấu hình QUOTE' }));
  expect(calls).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));
  expect(await screen.findByText('Bỏ thay đổi chưa lưu?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục sửa' }));
  fireEvent.click(save);
  expect(await screen.findByText('Lưu cấu hình hồ sơ thất bại.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
  expect(screen.getByRole('cell', { name: 'SPEC' })).toBeTruthy();
  expect(save.disabled).toBe(false);
  fail = false;
  fireEvent.click(save);
  await waitFor(() => expect(calls).toEqual([
    { version: 7, dossierTypeIds: [2, 4, 3] }, { version: 7, dossierTypeIds: [2, 4, 3] },
  ]));
  expect(await screen.findByText('Đã lưu cấu hình hồ sơ.')).toBeTruthy();
  expect(save.disabled).toBe(true);
});
