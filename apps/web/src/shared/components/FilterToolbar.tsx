import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Stack } from '@mui/material';
import { tokens } from '../../config/theme';
import { ActionButton } from './ActionButton';

/**
 * Standard list filter row (COMMON-LIST-002): the feature's search + filter controls, then "Làm mới" right after the
 * last control with the same gap (never pushed to the far edge) and wrapping with them. Làm mới is always available;
 * it is disabled only while that refresh runs. The caller resets keyword, filters, sort and page (keeping the page size)
 * and queries the server again, also when everything is already at its default.
 */
export function FilterToolbar({ onRefresh, refreshing, children }: {
  onRefresh?: () => void; refreshing?: boolean; children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-end',
      '& .MuiOutlinedInput-root': { minHeight: tokens.control, height: tokens.control },
      '& .MuiOutlinedInput-input': { py: 0 } }}>
      {children}
      {onRefresh && <ActionButton action="refresh" onClick={onRefresh} disabled={refreshing}
        sx={{ flexShrink: 0, height: tokens.control }}>{t('common.refresh')}</ActionButton>}
    </Stack>
  );
}
