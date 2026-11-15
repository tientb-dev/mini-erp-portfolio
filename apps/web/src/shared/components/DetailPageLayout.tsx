import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { ErrorAlert } from './ErrorAlert';
import { PageHeader } from './PageHeader';

/**
 * Document detail skeleton: "<title> <documentNumber>" header with an inline status, optional subtitle, the action group
 * on the right, a notice line (e.g. who the document waits for) and the content (often DetailTabs).
 * `footer` is a decision bar pinned to the bottom of the viewport while it scrolls (it stays in the page flow, so it
 * never covers the last content). While `loading` it shows only the error (if any) or a progress bar.
 */
export function DetailPageLayout({ title, documentNumber, status, subtitle, actions, notice, loading, error, breadcrumbs, backTo, footer, children }: {
  title: string; documentNumber?: string; status?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; notice?: ReactNode;
  loading?: boolean; error?: unknown; children?: ReactNode;
  /** Shown above the title. */ breadcrumbs?: ReactNode; /** Back arrow next to the title, to this route. */ backTo?: string;
  /** Sticky bottom bar for the document's decision (e.g. Chốt hợp đồng). */ footer?: ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) return <>{breadcrumbs}{error ? <ErrorAlert error={error} /> : <LinearProgress aria-label={t('common.loading')} />}</>;
  return (
    // Fills the main scroll area so the footer (mt: auto) rests on its bottom edge when the page is short.
    <Stack sx={{ flex: '1 0 auto' }}>
      <PageHeader title={documentNumber ? `${title} ${documentNumber}` : title} status={status} subtitle={subtitle} action={actions} breadcrumbs={breadcrumbs} backTo={backTo} />
      {notice && <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5, mb: 2 }}>{notice}</Typography>}
      <Stack spacing={2} sx={{ mb: footer ? 3 : 0 }}>
        <ErrorAlert error={error} />
        {children}
      </Stack>
      {footer && (
        <Box
          component="section"
          aria-label={t('common.decision')}
          sx={{
            position: 'sticky', bottom: 0, zIndex: 2, mt: 'auto', mx: { xs: -2, md: -3 }, mb: -3, px: { xs: 2, md: 3 }, py: 1.5,
            bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
          }}
        >
          {footer}
        </Box>
      )}
    </Stack>
  );
}
