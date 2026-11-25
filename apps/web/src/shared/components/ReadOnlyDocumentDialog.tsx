import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';

export function ReadOnlyDocumentDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="record-detail-title">
      <DialogTitle id="record-detail-title">{title}</DialogTitle>
      <DialogContent><Stack spacing={1.5} sx={{ overflowWrap: 'anywhere' }}>{children}</Stack></DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>{t('common.close')}</Button></DialogActions>
    </Dialog>
  );
}
