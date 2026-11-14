import { FormEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';
import { ErrorAlert } from './ErrorAlert';

/** Standard create/edit dialog: title, fields, Cancel + primary action; Enter submits. */
export function FormDialog(props: { title: string; submitLabel: string; error: unknown; pending: boolean; canSubmit: boolean; onSubmit: () => void; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const submit = (e: FormEvent) => { e.preventDefault(); if (props.canSubmit && !props.pending) props.onSubmit(); };
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm" slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
      <DialogTitle variant="h2">{props.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ErrorAlert error={props.error} />
          {props.children}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="contained" disabled={!props.canSubmit || props.pending}>{props.submitLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
