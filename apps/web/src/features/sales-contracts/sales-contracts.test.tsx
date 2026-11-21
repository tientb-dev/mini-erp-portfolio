import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { SalesContractsPage } from '.';

const SALES = ['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CREATE', 'CUSTOMER.VIEW'];
const row = (id: number, status: string, documentNumber = `SC-2026-00000${id}`) => ({
  id, documentNumber, status, version: 2, customerId: 8, customerName: 'Customer 1', createdByName: 'Sales', createdAt: '2026-11-13T00:00:00Z',
  pendingProposals: 0, lineCount: 1, responsibleSalesUserId: 2, responsibleSalesName: 'Sales A',
});
const line = { id: 12, itemCode: 'SW', itemName: 'Switch', uomName: 'Cái', unitOfMeasureId: 1, uomCode: 'PCS', quantity: '10.000', products: [] };
const detail = (status: string, extra: object = {}) => ({ ...row(4, status), customerCode: 'C1', createdBy: 2, updatedAt: null, updatedByName: null, lines: [line], ...extra });
const common = { '/customers': [{ id: 8, code: 'C1', name: 'Customer 1' }], '/units-of-measure': [{ id: 1, code: 'PCS', name: 'Cái' }, { id: 2, code: 'BOX', name: 'Hộp' }],
  '/sales-contracts/responsible-sales-candidates': [{ id: 2, fullName: 'Sales A' }] };

function Where() { return <span data-testid="where">{useLocation().pathname + useLocation().search}</span>; }
function Detail() { return <SalesContractsPage initialId={Number(useParams().id)} />; }
const renderAt = (url: string) => wrap(
  <><Routes><Route path="/sales-contracts" element={<SalesContractsPage />} /><Route path="/sales-contracts/:id" element={<Detail />} /></Routes><Where /></>, url);
const fetched = () => vi.mocked(globalThis.fetch).mock.calls.map(([u]) => String(u).replace(/^https?:\/\/[^/]+/, ''));
const pick = async (label: RegExp | string, option: string) => {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

describe('Sales contract list', () => {
  it('searches, filters and pages on the server; the number is a real link; row click opens, action icons do not', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts?': { items: [row(4, 'DRAFT')], total: 1 }, ...common });
    renderAt('/sales-contracts');
    const link = await screen.findByRole('link', { name: 'SC-2026-000004' });
    expect(link.getAttribute('href')).toBe('/sales-contracts/4');
    expect(fetched()).toContain('/sales-contracts?page=1&pageSize=25');

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'cust' } });
    await waitFor(() => expect(fetched()).toContain('/sales-contracts?q=cust&page=1&pageSize=25'));
    await pick('Trạng thái', 'Nháp');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sales-contracts?q=cust&status=DRAFT'));

    fireEvent.click(screen.getByRole('button', { name: 'Thao tác SC-2026-000004' }));
    expect(await screen.findByRole('menuitem', { name: 'Hủy hợp đồng' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toMatch(/^\/sales-contracts\?/); // the action did not open the row
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    fireEvent.click(screen.getByText('Customer 1'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sales-contracts/4'));
  });

  it('a viewer without SALES_CONTRACT.CREATE gets no create button and only "Xem chi tiết" in the row menu', async () => {
    mockApi({ '/auth/me': me(['SALES_CONTRACT.VIEW']), '/sales-contracts?': { items: [row(4, 'DRAFT')], total: 1 } });
    renderAt('/sales-contracts');
    await screen.findByRole('link', { name: 'SC-2026-000004' });
    expect(screen.queryByRole('button', { name: 'Tạo hợp đồng' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thao tác SC-2026-000004' }));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['Xem chi tiết']);
    expect(screen.queryByRole('combobox', { name: 'Sales phụ trách' })).toBeNull(); // candidates need CREATE
  });

  it('creates a header-only DRAFT and opens it', async () => {
    const posts = mockApi({ '/auth/me': me(SALES), '/sales-contracts?': { items: [], total: 0 }, '/sales-contracts/99': detail('DRAFT', { id: 99, lines: [] }), ...common });
    renderAt('/sales-contracts');
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo hợp đồng' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/Mã hàng/)).toBeNull(); // no item lines in the create dialog
    await pick(/Khách hàng/, 'C1: Customer 1');
    await pick('Sales phụ trách', 'Sales A');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo hợp đồng' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/sales-contracts', body: { customerId: 8, responsibleSalesUserId: 2 } }]));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sales-contracts/99'));
    expect(await screen.findByText('Hợp đồng chưa có hàng hóa. Bấm "Thêm hàng hóa" để nhập từng dòng theo hợp đồng đã ký.')).toBeTruthy();
  });
});

describe('Sales contract list pagination (regression: Next jumped back to page 1)', () => {
  const page = (ids: number[]) => ({ items: ids.map((id) => row(id, 'DRAFT', `SC-P-${String(id).padStart(3, '0')}`)), total: 30 });
  it('Next loads page 2 and stays there; URL, rows and label agree', async () => {
    mockApi({
      '/auth/me': me(SALES), ...common,
      '/sales-contracts?page=1': page(Array.from({ length: 25 }, (_, i) => 30 - i)),
      '/sales-contracts?page=2': page([5, 4, 3, 2, 1]),
    });
    renderAt('/sales-contracts');
    await screen.findByRole('link', { name: 'SC-P-030' });
    fireEvent.click(screen.getByRole('button', { name: /Tới trang tiếp theo|next page/i }));
    expect(await screen.findByRole('link', { name: 'SC-P-005' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50)); // the grid's debounced reset used to fire here
    expect(screen.getByTestId('where').textContent).toBe('/sales-contracts?page=2');
    expect(screen.queryByRole('link', { name: 'SC-P-030' })).toBeNull();
    expect(screen.getByText(/^26–30 (trên|of) 30$/)).toBeTruthy();
    const calls = fetched().filter((u) => u.startsWith('/sales-contracts?'));
    expect(calls.at(-1)).toBe('/sales-contracts?page=2&pageSize=25'); // no request back to page 1 after page 2
  });
});

describe('Sales contract detail', () => {
  it('shows breadcrumbs, a Back arrow to the list and the Hàng hóa tab with its count', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('DRAFT'), ...common });
    renderAt('/sales-contracts/4');
    expect(await screen.findByRole('heading', { name: 'SC-2026-000004' })).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Vị trí trang' });
    expect(within(crumbs).getByRole('link', { name: 'Trang chủ' }).getAttribute('href')).toBe('/');
    expect(within(crumbs).getByRole('link', { name: 'Hợp đồng bán' }).getAttribute('href')).toMatch(/^\/sales-contracts/);
    expect(within(crumbs).getByText('SC-2026-000004').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Quay lại danh sách' }).getAttribute('href')).toMatch(/^\/sales-contracts/);
    expect(screen.getByRole('tab', { name: 'Hàng hóa (1)', selected: true })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Đề nghị mua hàng (PR)' })).toBeNull(); // no PR.VIEW
  });

  it('adds a line from the UoM catalog; the version is sent', async () => {
    const posts = mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('DRAFT'), ...common });
    renderAt('/sales-contracts/4');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm hàng hóa' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Mã hàng theo HĐ/), { target: { value: 'RT' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên hàng theo HĐ/), { target: { value: 'Router' } });
    await pick(/Đơn vị tính/, 'Hộp (BOX)');
    fireEvent.change(within(dialog).getByLabelText(/Số lượng/), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu hàng hóa' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/sales-contracts/4/lines', body: { itemCode: 'RT', itemName: 'Router', unitOfMeasureId: 2, quantity: 3, version: 2 } }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('edits one line by its id and deletes after confirmation', async () => {
    const posts = mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('DRAFT'), ...common });
    renderAt('/sales-contracts/4');
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa hàng hóa' }));
    const qty = await screen.findByLabelText(/Số lượng/);
    expect((qty as HTMLInputElement).value).toBe('10');
    fireEvent.change(qty, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/sales-contract-lines/12', body: { itemCode: 'SW', itemName: 'Switch', unitOfMeasureId: 1, quantity: 12, version: 2 } }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Xóa hàng hóa' }));
    const confirm = await screen.findByRole('dialog');
    expect(posts).toHaveLength(1); // nothing deleted before confirming
    fireEvent.click(within(confirm).getByRole('button', { name: 'Xóa hàng hóa' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ url: '/sales-contract-lines/12?version=2', body: {} }));
  });

  it('keeps the dialog and its input when the API fails', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('DRAFT'), ...common });
    const ok = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => (init?.method === 'PATCH'
      ? new Response(JSON.stringify({ code: 'STALE_VERSION', detail: 'stale' }), { status: 409 }) : ok(input, init)));
    renderAt('/sales-contracts/4');
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa hàng hóa' }));
    fireEvent.change(await screen.findByLabelText(/Số lượng/), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Dữ liệu đã được người khác thay đổi');
    expect((screen.getByLabelText(/Số lượng/) as HTMLInputElement).value).toBe('15');
  });

  it('asks before discarding unsaved input (Hủy bỏ / X)', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('DRAFT'), ...common });
    renderAt('/sales-contracts/4');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm hàng hóa' }));
    fireEvent.change(await screen.findByLabelText(/Mã hàng theo HĐ/), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục sửa' }));
    expect((screen.getByLabelText(/Mã hàng theo HĐ/) as HTMLInputElement).value).toBe('X');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ thay đổi' }));
    await waitFor(() => expect(screen.queryByLabelText(/Mã hàng theo HĐ/)).toBeNull());
  });

  it('an ACTIVE contract has no header edit and no line add/edit/delete', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('ACTIVE'), ...common });
    renderAt('/sales-contracts/4');
    await screen.findByRole('heading', { name: 'SC-2026-000004' });
    for (const name of ['Sửa thông tin', 'Thêm hàng hóa', 'Sửa hàng hóa', 'Xóa hàng hóa', 'Chốt hợp đồng']) expect(screen.queryByRole('button', { name })).toBeNull();
    const bar = screen.getByRole('region', { name: 'Thao tác quyết định' });
    expect(within(bar).getByRole('button', { name: 'Hủy hợp đồng' })).toBeTruthy(); // Hủy lives in the footer, not the header
  });

  it('lists the PRs of the contract by sales_contract_id with links, for PR.VIEW', async () => {
    mockApi({
      '/auth/me': me([...SALES, 'PR.VIEW']), '/sales-contracts/4': detail('ACTIVE'),
      '/purchase-requisitions?salesContractId=4': [{ id: 7, documentNumber: 'PR-2026-000007', approvalStatus: 'APPROVED', category: 'SALES_GOODS', createdAt: '2026-11-14T00:00:00Z', createdByName: 'PM' }],
    });
    renderAt('/sales-contracts/4');
    fireEvent.click(await screen.findByRole('tab', { name: 'Đề nghị mua hàng (PR)' }));
    expect((await screen.findByRole('link', { name: 'PR-2026-000007' })).getAttribute('href')).toBe('/purchase-requisitions/7');
    expect(fetched()).toContain('/purchase-requisitions?salesContractId=4');
  });
});

describe('Sales contract design rules (PR #17)', () => {
  it('every row has one ⋯ menu listing only the actions that can run now', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts?': { items: [row(4, 'DRAFT'), row(5, 'ACTIVE'), row(6, 'CANCELED')], total: 3 }, ...common });
    renderAt('/sales-contracts');
    await screen.findByRole('link', { name: 'SC-2026-000005' });
    for (const n of [4, 5, 6]) expect(screen.getByRole('button', { name: `Thao tác SC-2026-00000${n}` })).toBeTruthy();
    expect(screen.getAllByText('13/11/2026')).toHaveLength(3); // dd/MM/yyyy, time in the tooltip

    const menu = async (n: number) => {
      fireEvent.click(screen.getByRole('button', { name: `Thao tác SC-2026-00000${n}` }));
      const items = await screen.findAllByRole('menuitem');
      const state = items.map((m) => m.textContent);
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      return state;
    };
    expect(await menu(4)).toEqual(['Xem chi tiết', 'Sửa thông tin', 'Chốt hợp đồng', 'Hủy hợp đồng']);
    expect(await menu(5)).toEqual(['Xem chi tiết', 'Hủy hợp đồng']); // ACTIVE: no edit, no activate
    expect(await menu(6)).toEqual(['Xem chi tiết']); // CANCELED
  });

  it('a draft that cannot be activated yet (no lines / no responsible sales) has no "Chốt" in the row menu', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts?': { items: [{ ...row(4, 'DRAFT'), lineCount: 0 }, { ...row(5, 'DRAFT'), responsibleSalesUserId: null }], total: 2 }, ...common });
    renderAt('/sales-contracts');
    for (const n of [4, 5]) {
      fireEvent.click(await screen.findByRole('button', { name: `Thao tác SC-2026-00000${n}` }));
      expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['Xem chi tiết', 'Sửa thông tin', 'Hủy hợp đồng']);
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
  });

  it('the footer holds Hủy (outlined, red) and Chốt (contained) side by side for a draft', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('DRAFT'), ...common });
    renderAt('/sales-contracts/4');
    const bar = await screen.findByRole('region', { name: 'Thao tác quyết định' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hủy hợp đồng', 'Chốt hợp đồng']);
    expect(within(bar).getByRole('button', { name: 'Hủy hợp đồng' }).className).toMatch(/MuiButton-outlined .*MuiButton-colorError/);
    expect(screen.getAllByRole('button', { name: 'Hủy hợp đồng' })).toHaveLength(1); // not repeated in the header
  });

  it('"Xóa bộ lọc" is always shown, disabled without filters; clearing keeps sort and page size, goes to page 1; Back re-enables it', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts?': { items: [row(4, 'DRAFT')], total: 1 }, ...common });
    function Back() { const nav = useNavigate(); return <button onClick={() => nav(-1)}>history-back</button>; }
    wrap(<><Routes><Route path="/sales-contracts" element={<SalesContractsPage />} /></Routes><Where /><Back /></>,
      '/sales-contracts?q=cust&status=DRAFT&customerId=8&sort=documentNumber&order=asc&pageSize=50&page=2');
    const clear = await screen.findByRole('button', { name: 'Xóa bộ lọc' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    expect((screen.getByRole('textbox', { name: 'Tìm kiếm' }) as HTMLInputElement).value).toBe('cust');
    fireEvent.click(clear);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sales-contracts?sort=documentNumber&order=asc&pageSize=50'));
    expect(clear.disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Tìm kiếm' }) as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(fetched().at(-1)).toContain('sort=documentNumber&order=asc&pageSize=50&page=1'));
    await new Promise((r) => setTimeout(r, 500)); // past the search debounce: it must not bring the cleared filters back
    expect(screen.getByTestId('where').textContent).toBe('/sales-contracts?sort=documentNumber&order=asc&pageSize=50');
    fireEvent.click(screen.getByText('history-back'));
    await waitFor(() => expect(clear.disabled).toBe(false));
    expect((screen.getByRole('textbox', { name: 'Tìm kiếm' }) as HTMLInputElement).value).toBe('cust');
    expect(screen.getByTestId('where').textContent).toContain('q=cust&status=DRAFT');
  });

  it('Chốt hợp đồng sits in the bottom bar and is disabled with the reason the server would give', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('DRAFT', { lines: [] }), ...common });
    renderAt('/sales-contracts/4');
    const bar = await screen.findByRole('region', { name: 'Thao tác quyết định' });
    expect((within(bar).getByRole('button', { name: 'Chốt hợp đồng' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(bar).getByText('Cần ít nhất một dòng hàng hóa để chốt.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thêm hàng hóa' }).className).toContain('MuiButton-contained');
  });

  it('the responsible sales sees the PR tab without PR.VIEW; another sales does not', async () => {
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('ACTIVE', { responsibleSalesUserId: 1 }), '/purchase-requisitions?salesContractId=4': [] });
    const { unmount } = renderAt('/sales-contracts/4');
    expect(await screen.findByRole('tab', { name: 'Đề nghị mua hàng (PR)' })).toBeTruthy(); // me() has id 1
    unmount();
    mockApi({ '/auth/me': me(SALES), '/sales-contracts/4': detail('ACTIVE', { responsibleSalesUserId: 2 }) });
    renderAt('/sales-contracts/4');
    await screen.findByRole('tab', { name: 'Hàng hóa (1)' });
    expect(screen.queryByRole('tab', { name: 'Đề nghị mua hàng (PR)' })).toBeNull();
  });
});

describe('Sales contract product proposals', () => {
  const withProposal = detail('ACTIVE', {
    lines: [{ ...line, products: [{ id: 21, productId: 5, partNumber: 'PN-1', name: 'Switch 24', status: 'PENDING', reason: 'Thay thế', decisionNote: null, proposedByName: 'PM', decidedByName: null, decidedAt: null }] }],
  });

  it('Sales sees confirm/reject on a pending proposal and confirms with a note', async () => {
    const posts = mockApi({ '/auth/me': me(['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CONFIRM_PRODUCT']), '/sales-contracts/4': withProposal });
    renderAt('/sales-contracts/4');
    await screen.findByText('PN-1: Switch 24');
    expect(screen.queryByRole('button', { name: 'Đề xuất mã hàng' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.change(await screen.findByLabelText('Ghi chú hoặc số phụ lục'), { target: { value: 'PL-01' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xác nhận' }).at(-1)!);
    await waitFor(() => expect(posts).toEqual([{ url: '/product-proposals/21/approve', body: { note: 'PL-01' } }]));
  });

  it('PM can propose but never confirm in place of Sales (04 §2)', async () => {
    mockApi({ '/auth/me': me(['SALES_CONTRACT.VIEW', 'SALES_CONTRACT.PROPOSE_PRODUCT']), '/sales-contracts/4': withProposal });
    renderAt('/sales-contracts/4');
    await screen.findByText('PN-1: Switch 24');
    expect(screen.getByRole('button', { name: 'Đề xuất mã hàng' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  });
});
