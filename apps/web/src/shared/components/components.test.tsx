import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@mui/material';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { DataTable, DetailPageLayout, DetailTabs, FilterToolbar, FormDialog, ListPageLayout, PageBreadcrumbs, ScrollTable } from '.';
import { ActionResultDialog } from './ActionResultDialog';
import { DocumentWorkflowStepper } from './DocumentWorkflow';
import { ActionButton } from './ActionButton';

it('maps common dialog buttons to semantic icons including disabled actions', () => {
  render(<FormDialog title="Fixture" submitLabel="Fixture save" submitAction="save" error={null} pending={false}
    canSubmit={false} onClose={() => undefined} onSubmit={() => undefined}><ActionButton action="delete">Remove file</ActionButton></FormDialog>);
  const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Fixture save' });
  expect(save.disabled).toBe(true);
  expect(save.querySelector('[data-testid=SaveOutlinedIcon]')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Hủy bỏ' }).querySelector('[data-testid=CloseIcon]')).toBeTruthy();
  const remove = screen.getByRole('button', { name: 'Remove file' });
  expect(remove.className).toContain('MuiButton-outlined');
  expect(remove.querySelector('[data-testid=DeleteOutlinedIcon]')).toBeTruthy();
});

it('shows the rejection at its own step and preserves the completed steps in a workflow round', () => {
  render(<DocumentWorkflowStepper caption="Vòng 2" steps={[
    { key: 'create', label: 'Khởi tạo', state: 'completed' },
    { key: 'approve', label: 'Phê duyệt', state: 'completed' },
    { key: 'receive', label: 'Tiếp nhận', state: 'rejected' },
  ]} />);
  expect(screen.getByText('Vòng 2')).toBeTruthy();
  expect(screen.getByLabelText('Phê duyệt: Hoàn thành').getAttribute('data-step-state')).toBe('completed');
  expect(screen.getByLabelText('Tiếp nhận: Bị từ chối').getAttribute('data-step-state')).toBe('rejected');
});

it('dismisses a success after three seconds and keeps failure open for acknowledgment', () => {
  vi.useFakeTimers();
  try {
    const onClose = vi.fn();
    const { rerender } = render(<ActionResultDialog result={{ success: true }} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Đã hiểu' })).toBeNull();
    act(() => vi.advanceTimersByTime(2999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<ActionResultDialog result={{ success: false, error: new Error('Fixture error') }} onClose={onClose} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('Fixture error');
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it('blocks SPA navigation from a dirty dialog until the user discards changes', async () => {
  const router = createMemoryRouter([
    { path: '/', element: <FormDialog title="Sửa" submitLabel="Lưu" error={null} pending={false} canSubmit dirty
      onSubmit={() => undefined} onClose={() => undefined}><input /></FormDialog> },
    { path: '/list', element: <h1>Danh sách sau khi rời form</h1> },
  ]);
  render(<RouterProvider router={router} />);
  await act(async () => { await router.navigate('/list'); });
  expect(router.state.location.pathname).toBe('/');
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục sửa' }));
  expect(router.state.location.pathname).toBe('/');
  await act(async () => { await router.navigate('/list'); });
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
  expect(await screen.findByRole('heading', { name: 'Danh sách sau khi rời form' })).toBeTruthy();
});

describe('ListPageLayout', () => {
  it('renders title, page actions, toolbar, the load error and the content', () => {
    render(
      <ListPageLayout title="Danh sách" actions={<Button>Tạo</Button>} toolbar={<span>bộ lọc</span>} error={{ code: 'X', message: 'hỏng' }}>
        <div>bảng</div>
      </ListPageLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Danh sách' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo' })).toBeTruthy();
    expect(screen.getByText('bộ lọc')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('hỏng');
    expect(screen.getByText('bảng')).toBeTruthy();
  });

  it('shows no alert without an error', () => {
    render(<ListPageLayout title="T"><div /></ListPageLayout>);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('DetailPageLayout', () => {
  it('while loading shows a labelled progress bar and nothing else', () => {
    render(<DetailPageLayout title="PO" loading actions={<Button>Duyệt</Button>}><div>nội dung</div></DetailPageLayout>);
    expect(screen.getByRole('progressbar', { name: 'Đang tải…' })).toBeTruthy();
    expect(screen.queryByText('nội dung')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('while loading with an error shows the error instead of the progress bar', () => {
    render(<DetailPageLayout title="PO" loading error={{ message: 'không có quyền' }} />);
    expect(screen.getByRole('alert').textContent).toContain('không có quyền');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders "<title> <documentNumber>", status, notice, actions and content', () => {
    render(
      <DetailPageLayout title="Đơn đặt hàng" documentNumber="PO-2026-000001" status={<span>Chờ duyệt</span>} notice="Đang chờ A duyệt" actions={<Button>Duyệt</Button>}>
        <div>nội dung</div>
      </DetailPageLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Đơn đặt hàng PO-2026-000001' })).toBeTruthy();
    expect(screen.getByText('Chờ duyệt')).toBeTruthy();
    expect(screen.getByText('Đang chờ A duyệt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Duyệt' })).toBeTruthy();
    expect(screen.getByText('nội dung')).toBeTruthy();
  });
});

describe('DetailTabs', () => {
  const tabs = [
    { key: 'a', label: 'Chung', content: <div>nội dung A</div> },
    { key: 'b', label: 'Ẩn', content: <div>nội dung B</div>, hidden: true },
    { key: 'c', label: 'Lịch sử', content: <div>nội dung C</div> },
  ];

  it('shows the first visible tab, hides hidden tabs and mounts only the active panel', () => {
    render(<DetailTabs tabs={tabs} />);
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['Chung', 'Lịch sử']);
    expect(screen.getByRole('tabpanel', { name: 'Chung' }).textContent).toBe('nội dung A');
    fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));
    expect(screen.getByRole('tabpanel', { name: 'Lịch sử' }).textContent).toBe('nội dung C');
    expect(screen.queryByText('nội dung A')).toBeNull();
  });

  it('can be controlled by key and reports changes', () => {
    const onChange = vi.fn();
    render(<DetailTabs tabs={tabs} value="c" onChange={onChange} />);
    expect(screen.getByText('nội dung C')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Chung' }));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('falls back to the first visible tab when the requested one is hidden', () => {
    render(<DetailTabs tabs={tabs} value="b" />);
    expect(screen.getByText('nội dung A')).toBeTruthy();
  });
});

describe('FormDialog', () => {
  const base = { title: 'Tạo', submitLabel: 'Lưu', error: null, onClose: () => undefined, children: <input aria-label="tên" /> };

  it('puts Cancel and the primary action in the footer; Cancel closes', () => {
    const onClose = vi.fn();
    render(<FormDialog {...base} pending={false} canSubmit onSubmit={() => undefined} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits once via Enter/submit and blocks a second submit while pending', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<FormDialog {...base} pending={false} canSubmit onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender(<FormDialog {...base} pending canSubmit onSubmit={onSubmit} />);
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('tên').closest('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps the primary action disabled until the form is valid', () => {
    render(<FormDialog {...base} pending={false} canSubmit={false} onSubmit={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('FormDialog closing', () => {
  const base = { title: 'Tạo', submitLabel: 'Lưu', error: null, canSubmit: true, onSubmit: () => undefined, children: <input aria-label="tên" /> };
  it('has an X button; closes without asking when nothing changed', () => {
    const onClose = vi.fn();
    render(<FormDialog {...base} pending={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('asks before discarding unsaved input (Escape too) and can keep editing', () => {
    const onClose = vi.fn();
    render(<FormDialog {...base} pending={false} dirty onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText('tên'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục sửa' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('cannot be closed while saving', () => {
    const onClose = vi.fn();
    render(<FormDialog {...base} pending onClose={onClose} />);
    expect((screen.getByRole('button', { name: 'Đóng' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Hủy bỏ' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PageBreadcrumbs and Back', () => {
  it('links parents, marks the current page, and the Back arrow goes to a fixed route', () => {
    render(
      <MemoryRouter>
        <DetailPageLayout title="HĐ" documentNumber="SC-1" backTo="/sales-contracts?q=a"
          breadcrumbs={<PageBreadcrumbs items={[{ label: 'Trang chủ', to: '/' }, { label: 'Bán hàng' }, { label: 'Hợp đồng bán', to: '/sales-contracts' }, { label: 'SC-1', to: '/x' }]} />} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Trang chủ' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('link', { name: 'Bán hàng' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'SC-1' })).toBeNull(); // the current page is not a link
    expect(screen.getByText('SC-1').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Quay lại danh sách' }).getAttribute('href')).toBe('/sales-contracts?q=a');
  });
});

describe('Fill layout markers (scroll standard, FRONTEND §10)', () => {
  it('DetailPageLayout and a fill ListPageLayout mark the page; DetailTabs and ScrollTable mark the scrolling region', () => {
    render(
      <MemoryRouter>
        <DetailPageLayout title="HĐ">
          <DetailTabs tabs={[{ key: 'a', label: 'Hàng hóa', content: (
            <ScrollTable label="Dòng">
              <TableHead><TableRow><TableCell>Mã</TableCell></TableRow></TableHead>
              <TableBody><TableRow><TableCell>SW</TableCell></TableRow></TableBody>
            </ScrollTable>
          ) }]} />
        </DetailPageLayout>
      </MemoryRouter>,
    );
    const table = screen.getByRole('table', { name: 'Dòng' });
    expect(table.className).toContain('MuiTable-stickyHeader');
    expect(table.closest('[data-fill-grow]')).toBeTruthy();
    expect(screen.getByRole('tabpanel').closest('[data-fill-grow]')).toBeTruthy();
    expect(table.closest('[data-fill-page]')).toBeTruthy();
  });
  it('ListPageLayout marks the page only when it opts in with fill', () => {
    const { container, rerender } = render(<ListPageLayout title="T"><div /></ListPageLayout>);
    expect(container.querySelector('[data-fill-page]')).toBeNull();
    rerender(<ListPageLayout title="T" fill><div /></ListPageLayout>);
    expect(container.querySelector('[data-fill-page]')).toBeTruthy();
  });
});

describe('DataTable loading and error (list standard)', () => {
  const rows = [{ id: 1, name: 'Dòng A' }];
  const base = { rows, columns: [{ field: 'name', headerName: 'Tên' }], rowCount: 30, paginationMode: 'server' as const, paginationModel: { page: 0, pageSize: 25 } };
  it('while loading: spinner over the previous rows, no empty state, pagination locked', () => {
    const onPage = vi.fn();
    render(<DataTable {...base} loading emptyHint="Trống" onPaginationModelChange={onPage} />);
    expect(screen.getByRole('progressbar', { name: 'Đang tải…' })).toBeTruthy();
    expect(screen.getByText('Dòng A')).toBeTruthy();
    expect(screen.queryByText('Trống')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tới trang tiếp theo|next page/i }));
    expect(onPage).not.toHaveBeenCalled();
  });
  it('on error: no spinner, rows cleared, a load-failed message, the page and total kept', () => {
    const onPage = vi.fn();
    const { rerender } = render(<DataTable {...base} onPaginationModelChange={onPage} />);
    rerender(<DataTable {...base} rowCount={0} paginationModel={{ page: 1, pageSize: 25 }} error={{ message: 'x' }} onPaginationModelChange={onPage} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('Dòng A')).toBeNull();
    expect(screen.getByText('Không tải được dữ liệu. Thử lại sau.')).toBeTruthy();
    expect(screen.getByText(/^26–30 (trên|of) 30$/)).toBeTruthy();
    expect(onPage).not.toHaveBeenCalled(); // the grid did not jump back to page 1 on its own
  });
});

describe('FilterToolbar (list standard)', () => {
  it('always shows "Xóa bộ lọc" last; disabled without filters, clears when enabled', () => {
    const onClear = vi.fn();
    const { rerender } = render(<FilterToolbar active={false} onClear={onClear}><input aria-label="q" /></FilterToolbar>);
    const btn = screen.getByRole('button', { name: /Xóa bộ lọc|Clear filters/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.previousElementSibling?.getAttribute('aria-label')).toBe('q');
    rerender(<FilterToolbar active onClear={onClear}><input aria-label="q" /></FilterToolbar>);
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
