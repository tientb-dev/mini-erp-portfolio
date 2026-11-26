import { Box, Tooltip } from '@mui/material';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { useTranslation } from 'react-i18next';

export function findDuplicateCodeRows<T extends { id: number; itemCode: string }>(rows: T[]) {
  const result = new Map<string, { id: number; number: number }[]>();
  rows.forEach((row, i) => {
    const code = row.itemCode.trim().toLowerCase();
    if (!code) return;
    const matches = result.get(code) ?? [];
    matches.push({ id: row.id, number: i + 1 });
    result.set(code, matches);
  });
  return (code: string, excludeId?: number) => (result.get(code.trim().toLowerCase()) ?? [])
    .filter(row => row.id !== excludeId).map(row => row.number);
}

export function DuplicateCodeWarning({ rows }: { rows: number[] }) {
  const { t } = useTranslation();
  if (!rows.length) return null;
  const label = t('master.duplicateRows', { rows: rows.join(', ') });
  return <Tooltip title={label}>
    <Box component="span" tabIndex={0} aria-label={label} role="img" sx={{ display: 'inline-flex', verticalAlign: 'middle', ml: 0.75 }}>
      <WarningAmberOutlined color="warning" sx={{ fontSize: 17 }} />
    </Box>
  </Tooltip>;
}
