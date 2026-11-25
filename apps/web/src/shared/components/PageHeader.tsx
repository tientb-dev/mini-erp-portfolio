import { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * Optional breadcrumbs, then the title row: Back arrow (a fixed route, not browser history), the title with an inline
 * status, an optional subtitle under it, and the page actions on the right; wraps on narrow screens.
 */
export function PageHeader({ title, action, breadcrumbs, backTo, status, subtitle, onBack, backLabel }: {
  title: string; action?: ReactNode; breadcrumbs?: ReactNode; backTo?: string; status?: ReactNode; subtitle?: ReactNode;
  onBack?: () => void; backLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={onBack ? 1 : 1.5} sx={{ mb: onBack ? { xs: 0.5, xl: 2 } : 3 }}>
      {breadcrumbs}
      {onBack && <Button variant="text" startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ alignSelf: 'flex-start', px: 0.5 }}>
        {backLabel ?? t('common.back')}
      </Button>}
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
