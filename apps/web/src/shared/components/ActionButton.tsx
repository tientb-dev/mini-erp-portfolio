import { Button, ButtonProps } from '@mui/material';
import Add from '@mui/icons-material/Add';
import Block from '@mui/icons-material/Block';
import CancelOutlined from '@mui/icons-material/CancelOutlined';
import Check from '@mui/icons-material/Check';
import Close from '@mui/icons-material/Close';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Download from '@mui/icons-material/Download';
import EditOutlined from '@mui/icons-material/EditOutlined';
import Refresh from '@mui/icons-material/Refresh';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import Send from '@mui/icons-material/Send';
import Upload from '@mui/icons-material/Upload';

export const actionIcons = {
  add: Add, save: SaveOutlined, cancel: Close, edit: EditOutlined, confirm: Check,
  refresh: Refresh, delete: DeleteOutlined, submit: Send, upload: Upload, download: Download,
  replace: Refresh, void: Block, reject: CancelOutlined,
};

export function ActionButton({ action, startIcon, variant, color, sx, ...props }: Omit<ButtonProps, 'action'> & {
  action: keyof typeof actionIcons;
}) {
  const Icon = actionIcons[action];
  const destructive = action === 'delete' || action === 'void' || action === 'reject' || color === 'error';
  const appearance = variant ?? (destructive || action === 'cancel' || action === 'refresh' ? 'outlined' : 'contained');
  return <Button {...props} color={destructive ? 'error' : color}
    variant={appearance} sx={[...(appearance === 'outlined' ? [{ bgcolor: 'background.paper', borderColor: destructive ? 'error.main' : 'primary.main' }] : []),
      ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
    startIcon={startIcon ?? <Icon />} />;
}
