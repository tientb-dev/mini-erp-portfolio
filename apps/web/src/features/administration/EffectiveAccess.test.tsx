import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { mockApi, wrap } from '../../test/helpers/api';
import { EffectiveAccess } from './EffectiveAccess';

it('filters by name and incomplete source grants, and expands only the chosen permission', async () => {
  mockApi({ '/admin/users/7/effective-access': {
    grants: { 'PR.VIEW': ['CREATOR', 'ORG_UNIT_TREE'], 'PO.VIEW': null },
    permissionModules: { 'PR.VIEW': 'PR', 'PO.VIEW': 'PO' },
    permissionNames: { 'PR.VIEW': 'Xem đề nghị mua hàng', 'PO.VIEW': 'Xem đơn đặt hàng' },
    sources: {
      'PR.VIEW': [
        { roleId: 1, roleCode: 'SALES', roleName: 'Kinh doanh', scopes: ['CREATOR', 'ORG_UNIT_TREE'] },
        { roleId: 2, roleCode: 'PARTIAL', roleName: 'Chờ cấu hình', scopes: [] },
      ],
      'PO.VIEW': [{ roleId: 1, roleCode: 'SALES', roleName: 'Kinh doanh', scopes: [] }],
    },
    orgUnitIds: [10], orgUnits: [
      { id: 10, code: 'KD', name: 'Khối Kinh doanh', parentId: null },
      { id: 11, code: 'MN', name: 'Miền Nam', parentId: 10 },
    ],
  } });
  wrap(<EffectiveAccess id={7} pending />);
  expect(await screen.findByText('Xem đề nghị mua hàng')).toBeTruthy();
  expect(screen.getByText('Không phân phạm vi')).toBeTruthy();
  expect(screen.queryByText('MN · Miền Nam')).toBeNull();
  const search = screen.getByPlaceholderText('Tên quyền hoặc mã kỹ thuật');
  fireEvent.change(search, { target: { value: 'đơn đặt hàng' } });
  expect(screen.queryByText('Xem đề nghị mua hàng')).toBeNull();
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lọc quyền' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Thiếu cấu hình phạm vi' }));
  expect(screen.queryByText('Xem đơn đặt hàng')).toBeNull();
  expect(screen.getByText('2 vai trò')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết quyền PR.VIEW' }));
  const detail = screen.getByRole('region', { name: 'Chi tiết quyền PR.VIEW' });
  expect(within(detail).getByText(/không đóng góp vào quyền hiệu lực/)).toBeTruthy();
  const root = within(detail).getByText('KD · Khối Kinh doanh').closest('li')!;
  expect(within(root).getByText('MN · Miền Nam')).toBeTruthy();
  expect(screen.getByText(/Quyền bên dưới theo cấu hình đã lưu/)).toBeTruthy();
});
