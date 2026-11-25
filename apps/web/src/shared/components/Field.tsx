import { ReactNode } from 'react';
import { Stack, Typography } from '@mui/material';

/** Label/value row for document headers; stacks on narrow screens. */
export function Field({ label, children, labelWidth = 200 }: { label: string; children: ReactNode; labelWidth?: number }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: { sm: labelWidth }, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" component="div" sx={{ minWidth: 0 }}>{children}</Typography>
    </Stack>
  );
}
