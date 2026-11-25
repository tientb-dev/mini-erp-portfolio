import { Box, Tooltip, type TooltipProps } from '@mui/material';
import Warning from '@mui/icons-material/WarningAmberRounded';
import type { ReactNode } from 'react';

export function ValidationTooltip(props: Pick<TooltipProps, 'title' | 'children'>) {
  return <Tooltip {...props} arrow describeChild slotProps={{
    tooltip: { sx: { bgcolor: 'background.paper', color: 'error.main', border: 1, borderColor: 'error.main' } },
    arrow: { sx: { color: 'background.paper', '&::before': { border: 1, borderColor: 'error.main' } } },
  }} />;
}

export function ValidationMessage({ children, warning }: { children?: ReactNode; warning?: boolean }) {
  return <Box role="status" sx={{ height: 34, mb: 0.5, px: 1, display: 'flex', alignItems: 'center', gap: 0.75,
    whiteSpace: 'nowrap', overflow: 'hidden', boxSizing: 'border-box', border: '1px solid',
    borderColor: warning ? 'error.main' : 'transparent', color: 'error.main', bgcolor: 'background.paper', borderRadius: 1 }}>
    {warning && <Warning fontSize="small" sx={{ flexShrink: 0 }} />}{children}
  </Box>;
}
