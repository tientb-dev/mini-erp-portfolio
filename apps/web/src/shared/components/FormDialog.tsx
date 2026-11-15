import { FormEvent, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Stack } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ErrorAlert } from './ErrorAlert';

/**
 * Standard create/edit/confirm dialog: title + X, fields, footer Cancel + primary action (right-aligned); Enter submits.
 * Closing (X, Cancel, Escape, backdrop) is blocked while saving and asks first when `dirty`. The dialog stays open on API
 * errors, so the parent closes it only from the mutation's onSuccess.
 */
export function FormDialog(props: {
  title: string; submitLabel: string; error: unknown; pending: boolean; canSubmit: boolean; onSubmit: () => void; onClose: () => void; children: ReactNode;
  /** Unsaved input: closing asks for confirmation. */ dirty?: boolean;
  /** `error` for destructive actions (delete, cancel). */ submitColor?: 'primary' | 'error';
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); if (props.canSubmit && !props.pending) props.onSubmit(); };
  const requestClose = () => {
    if (props.pending) return;
    if (props.dirty) setAsking(true);
    else props.onClose();
  };
  return (
    <>
      <Dialog open onClose={requestClose} fullWidth maxWidth="sm" slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
        <DialogTitle variant="h2" sx={{ pr: 6 }}>{props.title}</DialogTitle>
        <IconButton aria-label={t('common.close')} onClick={requestClose} disabled={props.pending} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <ErrorAlert error={props.error} />
            {props.children}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={requestClose} disabled={props.pending}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" color={props.submitColor ?? 'primary'} disabled={!props.canSubmit || props.pending}>{props.submitLabel}</Button>
        </DialogActions>
      </Dialog>
      {asking && (
        <Dialog open onClose={() => setAsking(false)} maxWidth="xs" aria-labelledby="discard-title">
          <DialogTitle id="discard-title" variant="h2">{t('common.discardTitle')}</DialogTitle>
          <DialogContent><DialogContentText>{t('common.discardHint')}</DialogContentText></DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setAsking(false)} autoFocus>{t('common.keepEditing')}</Button>
            <Button color="error" variant="contained" onClick={props.onClose}>{t('common.discard')}</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
