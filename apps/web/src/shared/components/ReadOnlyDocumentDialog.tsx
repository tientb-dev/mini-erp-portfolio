import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogActions, DialogContent, Stack } from '@mui/material';
import { ActionButton } from './ActionButton';
import { DialogHeading } from './DialogHeading';

export function ReadOnlyDocumentDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="record-detail-title">
      <DialogHeading id="record-detail-title" onClose={onClose}>{title}</DialogHeading>
      <DialogContent><Stack spacing={1.5} sx={{ overflowWrap: 'anywhere' }}>{children}</Stack></DialogContent>
      <DialogActions><ActionButton action="cancel" onClick={onClose}>{t('common.close')}</ActionButton></DialogActions>
    </Dialog>
  );
}
