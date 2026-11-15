import { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * Optional breadcrumbs, then the page title on the left (with a Back arrow when `backTo` is set: a fixed route,
 * not browser history) and the primary action on the right; wraps on narrow screens.
 */
export function PageHeader({ title, action, breadcrumbs, backTo }: { title: string; action?: ReactNode; breadcrumbs?: ReactNode; backTo?: string }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {breadcrumbs}
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          {backTo && (
            <Tooltip title={t('common.back')}>
              <IconButton component={RouterLink} to={backTo} aria-label={t('common.back')} edge="start"><ArrowBackIcon /></IconButton>
            </Tooltip>
          )}
          <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
        </Stack>
        {action}
      </Stack>
    </Stack>
  );
}
