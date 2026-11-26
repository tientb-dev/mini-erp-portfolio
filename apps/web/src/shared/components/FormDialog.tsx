import { FormEvent, ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogActions, DialogContent, DialogContentText, Stack, Typography } from '@mui/material';
import { ErrorAlert } from './ErrorAlert';
import { ActionButton, actionIcons } from './ActionButton';
import { DialogHeading } from './DialogHeading';

/**
 * Standard create/edit/confirm dialog: title + X, fields, footer Cancel + primary action (right-aligned); Enter submits.
 * Closing (X, Cancel, Escape, backdrop) is blocked while saving and asks first when `dirty`. The dialog stays open on API
 * errors, so the parent closes it only from the mutation's onSuccess.
 */
export function FormDialog(props: {
  title: string; submitLabel?: string; closeLabel?: string; error: unknown; pending: boolean; canSubmit: boolean; onSubmit: () => void; onClose: () => void; children: ReactNode;
  /** Unsaved input: closing asks for confirmation. */ dirty?: boolean;
  /** One short line under the title (what to enter, what happens). */ description?: ReactNode;
  submitAction?: keyof typeof actionIcons;
  footerAside?: ReactNode;
  compact?: boolean;
  pageGuardsNavigation?: boolean;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const router = useContext(UNSAFE_DataRouterContext);
  const submitting = useRef(false);
  const titleId = useId();
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
      <Dialog open onClose={requestClose} aria-labelledby={titleId} fullWidth maxWidth="sm" slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
        <DialogHeading id={titleId} onClose={requestClose} disabled={props.pending}>{props.title}</DialogHeading>
        <DialogContent data-compact={props.compact ? '' : undefined}>
          <Stack spacing={2}>
            {props.description && <Typography variant="body2" color="text.secondary">{props.description}</Typography>}
            <ErrorAlert error={props.error} />
            {props.children}
          </Stack>
        </DialogContent>
        <DialogActions>
          {props.footerAside && <Typography variant="body2" sx={{ mr: 'auto' }}>{props.footerAside}</Typography>}
          <ActionButton action="cancel" onClick={requestClose} disabled={props.pending}>{props.closeLabel ?? t('common.cancel')}</ActionButton>
          {props.submitLabel && <ActionButton action={props.submitAction ?? 'confirm'}
            type="submit" disabled={!props.canSubmit || props.pending}>{props.submitLabel}</ActionButton>}
        </DialogActions>
      </Dialog>
      {router && !props.pageGuardsNavigation && (props.dirty || props.pending)
        && <RouteDiscardGuard dirty={Boolean(props.dirty)} pending={props.pending} />}
      {asking && <DiscardDialog onKeep={() => setAsking(false)} onDiscard={() => { setAsking(false); props.onClose(); }} />}
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
          <DialogHeading id="discard-title" onClose={onKeep}>{t('common.discardTitle')}</DialogHeading>
          <DialogContent><DialogContentText>{t('common.discardHint')}</DialogContentText></DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <ActionButton action="edit" variant="outlined" onClick={onKeep} autoFocus>{t('common.keepEditing')}</ActionButton>
            <ActionButton action="delete" onClick={onDiscard}>{t('common.discard')}</ActionButton>
          </DialogActions>
        </Dialog>
  );
}
