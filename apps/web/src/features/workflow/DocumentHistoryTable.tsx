import { useState } from 'react';
import { Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { InfoOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { Field } from '../../shared/components';
import { ReadOnlyDocumentDialog } from '../../shared/components/ReadOnlyDocumentDialog';
import { fmtDate } from '../../shared/utils/format';
import { formatDocumentDate } from '../../shared/utils/document-date';
import { ActionButton } from '../../shared/components/ActionButton';
import type { HistoryEntry } from './types';

export function DocumentActivityDialog({ entry, onClose, title }: { entry: HistoryEntry; onClose: () => void; title?: string }) {
  const { t } = useTranslation();
  const activity = entry.action === 'DOSSIER_UPDATE' ? entry.metadata : undefined;
  function dossierValues(value: NonNullable<NonNullable<HistoryEntry['metadata']>['before']>) {
    return [t(value.hasPaper ? 'prDossier.yes' : 'prDossier.no'), formatDocumentDate(value.issuedOn ?? '', 'vi'),
      value.issuer, value.note, value.file?.name];
  }
  return (
    <ReadOnlyDocumentDialog title={title ?? t('pr.activityDetails')} onClose={onClose}>
      <Field label={t('pr.historyAction')}>{t(`doc.history.${entry.action}`)}</Field>
      <Field label={t('pr.historyActor')}>{entry.actorName}</Field>
      <Field label={t('pr.historyTime')}>{fmtDate(entry.createdAt)}</Field>
      {entry.metadata?.step && <Field label={t('pr.historyStep')}>{t(`pr.step.${entry.metadata.step}`)}</Field>}
      {entry.metadata?.from && <Field label={t('pr.currentAssignee')}>{entry.metadata.from.fullName}</Field>}
      {entry.metadata?.to && <Field label={t('pr.replacement')}>{entry.metadata.to.fullName}</Field>}
      {activity && <>
        <Field label={t('prDossier.type')}>{activity.name} ({activity.code})</Field>
        {activity.fileAction && <Field label={t('prDossier.file')}>{t(`prDossier.activity.${activity.fileAction}`)}</Field>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {(['before', 'after'] as const).map(key => {
            const value = activity[key];
            return value && <Stack key={key} spacing={1} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              <Typography sx={{ fontWeight: 700 }}>{t(`prDossier.${key}`)}</Typography>
              {dossierValues(value).map((text, index) => <Field key={index}
                label={t(`prDossier.${['hasPaper', 'date', 'issuer', 'note', 'file'][index]}`)}>{text || '—'}</Field>)}
            </Stack>;
          })}
        </Stack>
      </>}
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
            <TableCell><ActionButton action="confirm" startIcon={<InfoOutlined />} size="small" variant="outlined"
              onClick={() => setSelected(entry)}>{t('pr.viewActivity')}</ActionButton></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </TableContainer>
      {selected && <DocumentActivityDialog entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
