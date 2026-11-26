import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack } from '@mui/material';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import { ActionButton } from './ActionButton';

/**
 * Standard list filter row: the feature's search + filter controls, then "Xóa bộ lọc" always last and always shown
 * (disabled while nothing is applied), so the row never shifts. `active` must come from the applied filters (URL),
 * so Back/Forward update it too. It sits right after the last filter with the same gap (never pushed to the far edge) and wraps with them.
 */
export function FilterToolbar({ active, onClear, onRefresh, refreshing, children }: {
  active?: boolean; onClear?: () => void; onRefresh?: () => void; refreshing?: boolean; children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: onRefresh ? 'flex-end' : 'center' }}>
      {children}
      {onClear && <Button variant="text" color="inherit" startIcon={<RotateLeftIcon />} disabled={!active} onClick={onClear}
        sx={{ flexShrink: 0, color: 'text.secondary' }}>
        {t('common.clearFilters')}
      </Button>}
      {onRefresh && <ActionButton action="refresh" onClick={onRefresh} disabled={refreshing}
        sx={{ ml: 'auto', flexShrink: 0, height: 36 }}>{t('prPhase.refresh')}</ActionButton>}
    </Stack>
  );
}
