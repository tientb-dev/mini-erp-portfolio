import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack } from '@mui/material';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';

/**
 * Standard list filter row: the feature's search + filter controls, then "Xóa bộ lọc" always last and always shown
 * (disabled while nothing is applied), so the row never shifts. `active` must come from the applied filters (URL),
 * so Back/Forward update it too. Wraps on small screens; on a phone the button takes its own line.
 */
export function FilterToolbar({ active, onClear, children }: { active: boolean; onClear: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
      {children}
      <Button variant="text" color="inherit" startIcon={<RotateLeftIcon />} disabled={!active} onClick={onClear}
        sx={{ flexShrink: 0, color: 'text.secondary', ml: { sm: 'auto' }, alignSelf: { xs: 'flex-start', sm: 'center' } }}>
        {t('common.clearFilters')}
      </Button>
    </Stack>
  );
}
