import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import { Field } from '../../shared/components';
import { fmtDate } from '../../shared/utils/format';
import { HistoryEntry } from './types';

export function HistoryList({ history }: { history: HistoryEntry[] }) {
  const { t } = useTranslation();
  if (!history.length) return <Typography variant="body2" color="text.secondary">{t('gr.noHistory')}</Typography>;
  return (
    <>
      {history.map((h, i) => (
        <Field key={i} label={fmtDate(h.createdAt)}>
          {t(`doc.history.${h.action}`)}: {h.actorName}{h.reason ? `. ${h.reason}` : ''}
        </Field>
      ))}
    </>
  );
}
