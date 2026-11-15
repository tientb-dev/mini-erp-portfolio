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
 * Why an action is unavailable for this row, or null when it can run. Mirrors the server checks (edit/activate only
 * while DRAFT; activate needs a line and a responsible sales; cancel unless already canceled); the server re-checks.
 */
export function blockedReason(action: RowAction, r: ScRow): string | null {
  if (action === 'edit' && r.status !== 'DRAFT') return 'sc.onlyDraftEdit';
  if (action === 'activate') {
    if (r.status !== 'DRAFT') return 'sc.onlyDraftActivate';
    if (!r.lineCount) return 'sc.activateNeedLines';
    if (!r.responsibleSalesUserId) return 'sc.activateNeedSales';
  }
  if (action === 'cancel' && r.status === 'CANCELED') return 'sc.alreadyCanceled';
  return null;
}

/**
 * One ⋯ menu per row, always in the same place. Actions the user has no permission for are left out; actions the
 * status does not allow stay visible but disabled, with the reason under the label.
 */
export function ScRowMenu({ row, canManage, onAction }: { row: ScRow; canManage: boolean; onAction: (a: RowAction) => void }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items: { action: RowAction; label: string; Icon: typeof EditOutlined; danger?: boolean }[] = [
    { action: 'view', label: t('sc.view'), Icon: VisibilityOutlined },
    ...(canManage ? [
      { action: 'edit' as const, label: t('sc.editHeader'), Icon: EditOutlined },
      { action: 'activate' as const, label: t('sc.activate'), Icon: TaskAltOutlined },
      { action: 'cancel' as const, label: t('sc.cancel'), Icon: BlockOutlined, danger: true },
    ] : []),
  ];
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
        slotProps={{ paper: { sx: { minWidth: 220 } } }}>
        {items.map(({ action, label: text, Icon, danger }) => {
          const reason = blockedReason(action, row);
          return (
            <MenuItem key={action} disabled={Boolean(reason)} onClick={() => { setAnchor(null); onAction(action); }}
              sx={{ alignItems: 'flex-start', color: danger ? 'error.main' : undefined, '&.Mui-disabled': { opacity: 1, color: 'text.disabled' } }}>
              <ListItemIcon sx={{ color: 'inherit', mt: 0.25 }}><Icon fontSize="small" /></ListItemIcon>
              <ListItemText primary={text} secondary={reason ? t(reason) : undefined}
                slotProps={{ primary: { sx: { fontSize: '0.875rem' } }, secondary: { sx: { fontSize: '0.75rem', whiteSpace: 'normal' } } }} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
