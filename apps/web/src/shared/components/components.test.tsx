import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@mui/material';
import { DetailPageLayout, DetailTabs, FormDialog, ListPageLayout } from '.';

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
      <DetailPageLayout title="Đơn đặt mua" documentNumber="PO-2026-000001" status={<span>Chờ duyệt</span>} notice="Đang chờ A duyệt" actions={<Button>Duyệt</Button>}>
        <div>nội dung</div>
      </DetailPageLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Đơn đặt mua PO-2026-000001' })).toBeTruthy();
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
