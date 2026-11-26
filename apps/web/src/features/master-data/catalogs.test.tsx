import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { me, mockApi, wrap } from '../../test/helpers/api';
import { BrandsPage, CustomersPage } from '.';
import { CatalogPage } from './CatalogPage';
import { catalogs } from './catalogs';

it.each(Object.values(catalogs))('opens Create, View and direct Edit in the expected layout for $key', async catalog => {
  const path = '/' + catalog.path;
  const entry = { id: 1, code: 'CAD', partNumber: 'CAD', name: 'Fixture', description: 'Fixture description',
    isActive: true, brandId: 1, unitOfMeasureId: 1, rate: '8', exchangeRate: '17000', decimalPlaces: 2 };
  mockApi({ '/auth/me': me([catalog.create, catalog.update]), [path]: [entry],
    '/brands': [entry], '/units-of-measure': [entry] });
  for (const mode of ['new', 'view', 'edit']) {
    const url = path + (mode === 'new' ? '/new' : '/1' + (mode === 'edit' ? '?mode=edit' : ''));
    const screenView = wrap(<CatalogPage catalog={catalog} initialId={mode === 'new' ? 0 : 1} />, url);
    const description = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Mô tả' });
    expect(description.readOnly).toBe(mode === 'view');
    expect(description.value).toBe(mode === 'new' ? '' : entry.description);
    expect(Boolean(screen.queryByRole('dialog'))).toBe(!('fullPage' in catalog));
    screenView.unmount();
  }
});

it('opens a customer copy in the create popup with inherited repeatable fields and no write', async () => {
  const posts = mockApi({ '/auth/me': me(['CUSTOMER.VIEW', 'CUSTOMER.UPDATE', 'CUSTOMER.CREATE']),
    '/customers': [{ id: 7, code: 'BASE', name: 'Fixture customer', description: 'Inherited description', isActive: false }] });
  wrap(<CustomersPage initialId={0} />, '/customers/new?copy=7&q=BASE&status=false');
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole<HTMLInputElement>('textbox', { name: /^Mã/ }).value).toBe('');
  expect(dialog.getByRole<HTMLInputElement>('textbox', { name: /^Tên/ }).value).toBe('Fixture customer');
  expect(dialog.getByRole<HTMLTextAreaElement>('textbox', { name: 'Mô tả' }).value).toBe('Inherited description');
  expect(dialog.getByText('Đang sử dụng')).toBeTruthy();
  expect(dialog.queryByRole('button', { name: /Xóa/ })).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Hủy bỏ' }));
  expect(posts).toEqual([]);
});

it('stages supplier selections across search and refresh and submits them with the brand', async () => {
  const posts = mockApi({ '/auth/me': me(['PRODUCT.VIEW', 'PROCUREMENT_CATALOG.MANAGE', 'SUPPLIER.VIEW']), '/brands': [],
    '/suppliers': [{ id: 1, code: 'A', name: 'First', isActive: true }, { id: 2, code: 'B', name: 'Second', isActive: true },
      { id: 3, code: 'C', name: 'Inactive', isActive: false }] });
  wrap(<BrandsPage initialId={0} />, '/brands/new');
  expect(await screen.findByRole('columnheader', { name: 'Tên nhà cung cấp' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm nhà cung cấp' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.click(await dialog.findByRole('checkbox', { name: 'A' }));
  expect(dialog.queryByRole('checkbox', { name: 'C' })).toBeNull();
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'Second' } });
  fireEvent.click(await dialog.findByRole('checkbox', { name: 'B' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Làm mới' }));
  await waitFor(() => expect(dialog.getByRole<HTMLInputElement>('checkbox', { name: 'A' }).checked).toBe(true));
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận (2)' }));
  expect(posts).toEqual([]);
  fireEvent.change(screen.getByRole('textbox', { name: /^Mã/ }), { target: { value: 'NEW' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Tên/ }), { target: { value: 'New brand' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(posts).toEqual([{
    url: '/brands', body: { code: 'NEW', name: 'New brand', description: '', supplierIds: [1, 2] },
  }]));
});
