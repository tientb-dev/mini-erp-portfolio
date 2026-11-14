import { ReactNode } from 'react';
import { Stack, Typography } from '@mui/material';

/** Page title on the left, primary action on the right; wraps on narrow screens. */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
      <Typography variant="h1">{title}</Typography>
      {action}
    </Stack>
  );
}
