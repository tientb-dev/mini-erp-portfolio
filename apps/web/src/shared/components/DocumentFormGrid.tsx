import type { ReactNode } from 'react';
import { Box } from '@mui/material';

export function DocumentFormGrid({ children }: { children: ReactNode }) {
  return <Box sx={{
    display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', columnGap: 2, rowGap: 1.5,
    '& .MuiInputLabel-root': { fontWeight: 600 },
    '& .MuiOutlinedInput-root.MuiInputBase-multiline textarea': { padding: 0 },
  }}>{children}</Box>;
}

export function DocumentFormCell({ span = 12, children }: { span?: number; children: ReactNode }) {
  return <Box sx={{ minWidth: 0, gridColumn: { xs: 'span 12', md: `span ${span}` } }}>{children}</Box>;
}
