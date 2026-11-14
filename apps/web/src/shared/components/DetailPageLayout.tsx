import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearProgress, Stack, Typography } from '@mui/material';
import { ErrorAlert } from './ErrorAlert';
import { PageHeader } from './PageHeader';

/**
 * Document detail skeleton: "<title> <documentNumber>" header with the action group on the right, optional status,
 * a notice line (e.g. who the document waits for) and the content (often DetailTabs).
 * While `loading` it shows only the error (if any) or a progress bar; the feature decides status, actions and permissions.
 */
export function DetailPageLayout({ title, documentNumber, status, actions, notice, loading, error, children }: {
  title: string; documentNumber?: string; status?: ReactNode; actions?: ReactNode; notice?: ReactNode;
  loading?: boolean; error?: unknown; children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) return error ? <ErrorAlert error={error} /> : <LinearProgress aria-label={t('common.loading')} />;
  return (
    <>
      <PageHeader title={documentNumber ? `${title} ${documentNumber}` : title} action={actions} />
      {status && <Stack direction="row" sx={{ mb: 1 }}>{status}</Stack>}
      {notice && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{notice}</Typography>}
      <Stack spacing={2}>
        <ErrorAlert error={error} />
        {children}
      </Stack>
    </>
  );
}
