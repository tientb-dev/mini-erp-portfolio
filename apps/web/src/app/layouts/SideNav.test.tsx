import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageKey } from '../routes';
import { SideNav } from './SideNav';

const show = (active: PageKey | null, allowed: PageKey[]) => render(
  <MemoryRouter><SideNav active={active} allowed={(k) => allowed.includes(k)} onNavigate={() => undefined} /></MemoryRouter>,
);
const group = (name: string) => screen.getByRole('button', { name });

describe('SideNav', () => {
  it('shows only allowed children, hides parents without any, and starts with every parent expanded', () => {
    localStorage.clear();
    show(null, ['salesContracts', 'purchaseRequisitions']);
    expect(group('Bán hàng').getAttribute('aria-expanded')).toBe('true');
    expect(group('Mua hàng').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Kho vận' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Hợp đồng bán' }).getAttribute('href')).toBe('/sales-contracts');
    expect(screen.queryByRole('link', { name: 'Đơn đặt mua (PO)' })).toBeNull();
  });

  it('collapses each parent independently and remembers it across reloads', () => {
    localStorage.clear();
    const { unmount } = show(null, ['salesContracts', 'purchaseRequisitions']);
    fireEvent.click(group('Mua hàng'));
    expect(group('Mua hàng').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Đề nghị mua (PR)' })).toBeNull();
    expect(group('Bán hàng').getAttribute('aria-expanded')).toBe('true');
    unmount();
    show(null, ['salesContracts', 'purchaseRequisitions']);
    expect(group('Mua hàng').getAttribute('aria-expanded')).toBe('false');
  });

  it('re-opens a collapsed parent when its child is the current page, and marks it', () => {
    localStorage.setItem('mini-erp.nav.collapsed', JSON.stringify(['nav.purchasing']));
    show('purchaseRequisitions', ['salesContracts', 'purchaseRequisitions']);
    expect(group('Mua hàng').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Đề nghị mua (PR)' }).getAttribute('aria-current')).toBe('page');
  });
});
