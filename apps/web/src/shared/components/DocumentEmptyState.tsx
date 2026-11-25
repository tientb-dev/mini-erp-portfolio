import type { ReactNode } from 'react';
import { Stack, Typography } from '@mui/material';

export function DocumentEmptyState({ icon, label }: { icon: ReactNode; label: string }) {
  return <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', color: 'text.secondary', py: 2 }}>
    {icon}<Typography variant="body2">{label}</Typography>
  </Stack>;
}
