import { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * Optional breadcrumbs, then the title row: Back arrow (a fixed route, not browser history), the title with an inline
 * status, an optional subtitle under it, and the page actions on the right; wraps on narrow screens.
 */
export function PageHeader({ title, action, breadcrumbs, backTo, status, subtitle }: {
  title: string; action?: ReactNode; breadcrumbs?: ReactNode; backTo?: string; status?: ReactNode; subtitle?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1.5} sx={{ mb: 3 }}>
      {breadcrumbs}
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
          {backTo && (
            <Tooltip title={t('common.back')}>
              <IconButton component={RouterLink} to={backTo} aria-label={t('common.back')} edge="start" sx={{ mt: -0.25 }}><ArrowBackIcon /></IconButton>
            </Tooltip>
          )}
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
              {status}
            </Stack>
            {subtitle && <Typography variant="body1" color="text.secondary">{subtitle}</Typography>}
          </Stack>
        </Stack>
        {action && <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>{action}</Stack>}
      </Stack>
    </Stack>
  );
}
