import { FormEvent, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ErrorAlert } from './ErrorAlert';

/**
 * Standard create/edit/confirm dialog: title + X, fields, footer Cancel + primary action (right-aligned); Enter submits.
 * Closing (X, Cancel, Escape, backdrop) is blocked while saving and asks first when `dirty`. The dialog stays open on API
 * errors, so the parent closes it only from the mutation's onSuccess.
 */
export function FormDialog(props: {
  title: string; submitLabel?: string; closeLabel?: string; error: unknown; pending: boolean; canSubmit: boolean; onSubmit: () => void; onClose: () => void; children: ReactNode;
  /** Unsaved input: closing asks for confirmation. */ dirty?: boolean;
  /** `error` for destructive actions (delete, cancel). */ submitColor?: 'primary' | 'error';
  /** One short line under the title (what to enter, what happens). */ description?: ReactNode;
  submitIcon?: ReactNode;
  pageGuardsNavigation?: boolean;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const router = useContext(UNSAFE_DataRouterContext);
  const submitting = useRef(false);
  useEffect(() => {
    if (!props.dirty && !props.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [props.dirty, props.pending]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!props.canSubmit || props.pending || submitting.current) return;
    submitting.current = true;
    try { props.onSubmit(); } finally { queueMicrotask(() => { submitting.current = false; }); }
  };
  const requestClose = () => {
    if (props.pending) return;
    if (props.dirty) setAsking(true);
    else props.onClose();
  };
  return (
    <>
      <Dialog open onClose={requestClose} fullWidth maxWidth="sm" slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
        <DialogTitle variant="h2" sx={{ pr: 7 }}>{props.title}</DialogTitle>
        {props.description && <Typography variant="body2" color="text.secondary" sx={{ px: 3, pt: 0.75, pr: 7 }}>{props.description}</Typography>}
        <IconButton aria-label={t('common.close')} onClick={requestClose} disabled={props.pending} sx={{ position: 'absolute', right: 12, top: 14 }}>
          <CloseIcon />
        </IconButton>
        <DialogContent>
          <Stack spacing={2}>
            <ErrorAlert error={props.error} />
            {props.children}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="outlined" onClick={requestClose} disabled={props.pending}>{props.closeLabel ?? t('common.cancel')}</Button>
          {props.submitLabel && <Button type="submit" variant={props.submitColor === 'error' ? 'outlined' : 'contained'} startIcon={props.submitIcon}
            color={props.submitColor ?? 'primary'} disabled={!props.canSubmit || props.pending}>{props.submitLabel}</Button>}
        </DialogActions>
      </Dialog>
      {router && !props.pageGuardsNavigation && (props.dirty || props.pending)
        && <RouteDiscardGuard dirty={Boolean(props.dirty)} pending={props.pending} />}
      {asking && <DiscardDialog onKeep={() => setAsking(false)} onDiscard={props.onClose} />}
    </>
  );
}

export function RouteDiscardGuard({ dirty, pending, allowNavigation }: { dirty: boolean; pending: boolean; allowNavigation?: () => boolean }) {
  const blocker = useBlocker(() => (dirty || pending) && !allowNavigation?.());
  useEffect(() => {
    if (pending && blocker.state === 'blocked') blocker.reset();
  }, [pending, blocker]);
  if (pending || blocker.state !== 'blocked') return null;
  return <DiscardDialog onKeep={blocker.reset} onDiscard={blocker.proceed} />;
}

export function DiscardDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const { t } = useTranslation();
  return (
        <Dialog open onClose={onKeep} maxWidth="xs" aria-labelledby="discard-title">
          <DialogTitle id="discard-title" variant="h2">{t('common.discardTitle')}</DialogTitle>
          <DialogContent><DialogContentText>{t('common.discardHint')}</DialogContentText></DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button variant="outlined" onClick={onKeep} autoFocus>{t('common.keepEditing')}</Button>
            <Button color="error" variant="outlined" onClick={onDiscard}>{t('common.discard')}</Button>
          </DialogActions>
        </Dialog>
  );
}
