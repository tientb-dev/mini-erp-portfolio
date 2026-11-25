import { useState } from 'react';
import { Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Field } from '../../shared/components';
import { ReadOnlyDocumentDialog } from '../../shared/components/ReadOnlyDocumentDialog';
import { fmtDate } from '../../shared/utils/format';
import type { HistoryEntry } from './types';

export function DocumentActivityDialog({ entry, onClose, title }: { entry: HistoryEntry; onClose: () => void; title?: string }) {
  const { t } = useTranslation();
  return (
    <ReadOnlyDocumentDialog title={title ?? t('pr.activityDetails')} onClose={onClose}>
      <Field label={t('pr.historyAction')}>{t(`doc.history.${entry.action}`)}</Field>
      <Field label={t('pr.historyActor')}>{entry.actorName}</Field>
      <Field label={t('pr.historyTime')}>{fmtDate(entry.createdAt)}</Field>
      {entry.metadata?.step && <Field label={t('pr.historyStep')}>{t(`pr.step.${entry.metadata.step}`)}</Field>}
      {entry.metadata?.from && <Field label={t('pr.currentAssignee')}>{entry.metadata.from.fullName}</Field>}
      {entry.metadata?.to && <Field label={t('pr.replacement')}>{entry.metadata.to.fullName}</Field>}
      {entry.reason && <Field label={t('gr.reason')}><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{entry.reason}</Typography></Field>}
    </ReadOnlyDocumentDialog>
  );
}

export function DocumentHistoryTable({ history }: { history: HistoryEntry[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  if (!history.length) return <Typography variant="body2">{t('gr.noHistory')}</Typography>;
  return (
    <>
      <TableContainer sx={{ maxHeight: { xs: 260, md: 300 } }}>
        <Table size="small" stickyHeader aria-label={t('pr.history')} sx={{ minWidth: 610 }}>
          <TableHead><TableRow>
            {['historyTime', 'historyRound', 'historyAction', 'historyActor', 'historyStatus', 'activityDetails'].map(key => (
              <TableCell key={key}>{t(`pr.${key}`)}</TableCell>
            ))}
          </TableRow></TableHead>
          <TableBody>{history.map((entry, index) => <TableRow key={index}>
            <TableCell>{fmtDate(entry.createdAt)}</TableCell>
            <TableCell>{entry.round ?? '—'}</TableCell>
            <TableCell>{t(`doc.history.${entry.action}`)}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere', maxWidth: 240 }}>{entry.actorName}</TableCell>
            <TableCell>{entry.nextStatus ? t(`status.${entry.nextStatus}`) : '—'}</TableCell>
            <TableCell><Button size="small" variant="outlined" onClick={() => setSelected(entry)}>{t('pr.viewActivity')}</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </TableContainer>
      {selected && <DocumentActivityDialog entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
