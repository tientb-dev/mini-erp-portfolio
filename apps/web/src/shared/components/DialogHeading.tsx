import { ReactNode } from 'react';
import { DialogTitle, IconButton, Tooltip } from '@mui/material';
import Close from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

export function DialogHeading({ id, children, onClose, disabled }: {
  id?: string; children: ReactNode; onClose: () => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <DialogTitle id={id}>
    {children}
    <Tooltip title={t('common.close')}><span>
      <IconButton aria-label={t('common.close')} onClick={onClose} disabled={disabled}><Close /></IconButton>
    </span></Tooltip>
  </DialogTitle>;
}
