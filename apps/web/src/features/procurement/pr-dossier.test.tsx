import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { PurchaseRequisitionsPage } from './PurchaseDocPages';

const row = { dossierTypeId: 32, code: 'QUOTE', name: 'Báo giá', position: 1, version: 2,
  hasPaper: true, issuedOn: '2026-11-25', issuer: 'NCC ABC', note: '', file: { id: 45, name: 'Bao-gia.pdf' } };
const document = {
  id: 5, documentNumber: 'PR-2026-000005', approvalStatus: 'DONE', version: 7, approvalRound: 1,
  createdBy: 1, createdByName: 'Sales', createdAt: '2026-11-26', salesContractId: 9, category: 'MATERIAL',
  children: [], history: [], lines: [], canCancel: true,
};
const path = '/purchase-requisitions/5/dossier';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

async function dossierTab() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Hồ sơ' }));
  return screen.getByRole('tabpanel');
}

it('preserves local paper and file changes across tabs, blocks workflow, and sends one consolidated View save', async () => {
  mockApi({ '/auth/me': me(['PR.VIEW', 'PR.CREATE', 'PR.DOSSIER_MANAGE']), '/purchase-requisitions/5': document,
    [path]: { rows: [row], canManage: true } });
  const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
  const save = vi.fn().mockImplementationOnce(() => json({ detail: 'Fixture: conflict' }, 409))
    .mockImplementation(() => json({ rows: [{ ...row, hasPaper: false, issuer: 'NCC mới', file: null, version: 3 }], canManage: true }));
  vi.mocked(fetch).mockImplementation((url, init) =>
    init?.method === 'PUT' && String(url).endsWith(path) ? save(JSON.parse(String(init.body))) : defaultFetch(url, init));
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  const panel = within(await dossierTab());
  const checkbox = await panel.findByRole('checkbox', { name: 'Có bản giấy · Báo giá' });
  expect((panel.getByRole('button', { name: 'Lưu hồ sơ' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(checkbox);
  fireEvent.click(panel.getByRole('button', { name: 'Xóa file đính kèm' }));
  expect(screen.getByRole('dialog').textContent).toContain('Bao-gia.pdf');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy bỏ' }));
  expect(panel.getByRole('button', { name: 'Bao-gia.pdf' })).toBeTruthy();
  fireEvent.click(panel.getByRole('button', { name: 'Xóa file đính kèm' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa file' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Thông tin chung' }));
  const dossier = within(await dossierTab());
  expect((dossier.getByRole('textbox', { name: 'Người phát hành · Báo giá' }) as HTMLInputElement).value).toBe('NCC ABC');
  const issuer = dossier.getByRole<HTMLInputElement>('textbox', { name: 'Người phát hành · Báo giá' });
  expect(issuer.disabled).toBe(false);
  fireEvent.change(issuer, { target: { value: 'NCC mới' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hủy chứng từ' }));
  expect(screen.getByRole('dialog').textContent).toContain('Hãy lưu hoặc bỏ thay đổi hồ sơ');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
  fireEvent.click(dossier.getByRole('button', { name: 'Lưu hồ sơ' }));
  expect(await screen.findByText('Fixture: conflict')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Lưu hồ sơ thất bại' })).toBeTruthy();
  expect(screen.getByText(/kiểm tra phiên bản PR mới nhất/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
  expect(dossier.getByText('Có thay đổi chưa lưu')).toBeTruthy();
  fireEvent.click(dossier.getByRole('button', { name: 'Lưu hồ sơ' }));
  expect(await screen.findByRole('heading', { name: 'Lưu hồ sơ thành công' })).toBeTruthy();
  expect(screen.getByText('Đã cập nhật hồ sơ chứng từ của PR-2026-000005.')).toBeTruthy();
  expect(within(screen.getByRole('dialog')).queryByRole('button')).toBeNull();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith({ sessionKey: expect.any(String), rows: [
    { dossierTypeId: 32, version: 2, hasPaper: false, issuedOn: '2026-11-25', issuer: 'NCC mới', note: null, fileId: null },
  ] });
});

it('shows current and replacement file separately before staging a replacement', async () => {
  mockApi({ '/auth/me': me(['PR.VIEW', 'PR.DOSSIER_MANAGE']), '/purchase-requisitions/5': document,
    [path]: { rows: [row], canManage: true } });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  const panel = within(await dossierTab());
  await panel.findByRole('button', { name: 'Bao-gia.pdf' });
  const next = new File(['fixture'], 'Bao-gia-' + 'chi-tiet-'.repeat(12) + '.pdf');
  fireEvent.change(screen.getByRole('tabpanel').querySelector('input[type=file]')!, { target: { files: [next] } });
  const popup = within(screen.getByRole('dialog'));
  expect(popup.getByText('Bạn có chắc chắn muốn thay thế file của hồ sơ Báo giá?')).toBeTruthy();
  expect(popup.getByText('File hiện tại')).toBeTruthy();
  expect(popup.getByText('Bao-gia.pdf')).toBeTruthy();
  expect(popup.getByText('File thay thế')).toBeTruthy();
  expect(popup.getByText(next.name)).toBeTruthy();
  fireEvent.click(popup.getByRole('button', { name: 'Hủy bỏ' }));
  expect(panel.getByRole('button', { name: 'Bao-gia.pdf' })).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('keeps an attachment accessible in readonly and hides management actions', async () => {
  mockApi({ '/auth/me': me(['PR.VIEW']), '/purchase-requisitions/5': { ...document, approvalStatus: 'CANCELED' },
    [path]: { rows: [row], canManage: false } });
  wrap(<PurchaseRequisitionsPage initialId={5} />);
  const panel = within(await dossierTab());
  expect(await panel.findByRole('button', { name: 'Bao-gia.pdf' })).toBeTruthy();
  expect((panel.getByRole('checkbox', { name: 'Có bản giấy · Báo giá' }) as HTMLButtonElement).disabled).toBe(true);
  expect(panel.queryByRole('button', { name: 'Lưu hồ sơ' })).toBeNull();
  expect(panel.queryByRole('button', { name: 'Thay thế file đính kèm' })).toBeNull();
  expect(panel.getByText('25/11/2026')).toBeTruthy();
});

it('shows the configuration in Create and retains an invalid date during a tab change', async () => {
  mockApi({ '/auth/me': me(['PR.CREATE', 'PR.DOSSIER_MANAGE']),
    '/purchase-requisitions/catalog/dossier': { revision: 'fixture', rows: [
      { dossierTypeId: row.dossierTypeId, code: row.code, name: row.name, position: 1 },
    ] } });
  wrap(<PurchaseRequisitionsPage initialId={0} />);
  const panel = within(await dossierTab());
  fireEvent.click(await panel.findByRole('checkbox', { name: 'Có bản giấy · Báo giá' }));
  const date = panel.getByRole('textbox', { name: 'Ngày phát hành · Báo giá' }) as HTMLInputElement;
  fireEvent.change(date, { target: { value: '31/02/2026' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Thông tin chung' }));
  const nextPanel = within(await dossierTab());
  await waitFor(() => expect((nextPanel.getByRole('textbox', { name: 'Ngày phát hành · Báo giá' }) as HTMLInputElement).value).toBe('31/02/2026'));
  expect(nextPanel.queryByRole('button', { name: 'Lưu hồ sơ' })).toBeNull();
  expect(nextPanel.getByRole('button', { name: 'Tải lên' }).querySelector('svg')).toBeTruthy();
});
