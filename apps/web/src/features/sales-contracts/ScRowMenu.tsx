import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import MoreHoriz from '@mui/icons-material/MoreHoriz';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { ScRow } from './types';

export type RowAction = 'view' | 'edit' | 'activate' | 'cancel';

/**
 * Whether an action can run for this row now. Mirrors the server checks (edit/activate only while DRAFT; activate needs
 * a line and a responsible sales; cancel unless already canceled); the server re-checks.
 */
export function canRun(action: RowAction, r: ScRow): boolean {
  if (action === 'edit') return r.status === 'DRAFT';
  if (action === 'activate') return r.status === 'DRAFT' && r.lineCount > 0 && Boolean(r.responsibleSalesUserId);
  if (action === 'cancel') return r.status !== 'CANCELED';
  return true;
}

/**
 * One ⋯ menu per row, always in the same place. It lists only actions that can run now: no permission or a status /
 * condition that blocks it (canRun) → the item is left out. Why Chốt is blocked is explained on the detail page.
 */
export function ScRowMenu({ row, canManage, onAction }: { row: ScRow; canManage: boolean; onAction: (a: RowAction) => void }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items: { action: RowAction; label: string; Icon: typeof EditOutlined; danger?: boolean }[] = [
    { action: 'view' as const, label: t('sc.view'), Icon: VisibilityOutlined },
    ...(canManage ? [
      { action: 'edit' as const, label: t('sc.editHeader'), Icon: EditOutlined },
      { action: 'activate' as const, label: t('sc.activate'), Icon: TaskAltOutlined },
      { action: 'cancel' as const, label: t('sc.cancel'), Icon: BlockOutlined, danger: true },
    ] : []),
  ].filter((x) => canRun(x.action, row));
  const label = `${t('common.actions')} ${row.documentNumber}`;
  return (
    <>
      <Tooltip title={t('common.actions')}>
        <IconButton size="small" aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
          onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}>
          <MoreHoriz fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}>
        {items.map(({ action, label: text, Icon, danger }) => (
          <MenuItem key={action} onClick={() => { setAnchor(null); onAction(action); }} sx={{ color: danger ? 'error.main' : undefined }}>
            <ListItemIcon sx={{ color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={text} slotProps={{ primary: { sx: { fontSize: '0.875rem' } } }} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
