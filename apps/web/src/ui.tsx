import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Chip, Paper, Stack, Typography } from '@mui/material';
import { DataGrid, DataGridProps, GridValidRowModel } from '@mui/x-data-grid';
import { statusTones, StatusTone } from './theme';

/** Page title on the left, primary action on the right; wraps on narrow screens. */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
      <Typography variant="h1">{title}</Typography>
      {action}
    </Stack>
  );
}

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  const c = statusTones[tone];
  return <Chip size="small" label={label} sx={{ color: c.fg, bgcolor: c.bg, fontWeight: 600, borderRadius: 1 }} />;
}

/** approval_status → tone (03 §6). Labels come from i18n `status.*`. */
export const approvalTone: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  WAITING_FOR_APPROVE: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELED: 'muted',
};

export function ApprovalStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return <StatusChip label={t(`status.${status}`)} tone={approvalTone[status] ?? 'neutral'} />;
}

export function ActiveChip({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return <StatusChip label={t(active ? 'common.active' : 'common.inactive')} tone={active ? 'success' : 'muted'} />;
}

/** Shows the API Problem Details message; tells the user what to do next. */
export function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  // Known business codes have their own message; anything else shows the API detail.
  const { code, message } = error as { code?: string; message: string };
  const detail = code ? t(`errors.${code}`, { defaultValue: message }) : message;
  return <Alert severity="error">{t('common.error', { detail })}</Alert>;
}

/** Standard data table: compact rows, bordered surface, localized empty state with a hint. */
export function DataTable<R extends GridValidRowModel>({ emptyHint, ...props }: DataGridProps<R> & { emptyHint?: string }) {
  const { t } = useTranslation();
  return (
    <Paper sx={{ overflow: 'hidden', '& .MuiDataGrid-root': { border: 0 } }}>
      <DataGrid
        density="compact"
        autoHeight
        disableRowSelectionOnClick
        pageSizeOptions={[25, 50, 100]}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        slots={{
          noRowsOverlay: () => (
            <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">{emptyHint ?? t('common.empty')}</Typography>
            </Stack>
          ),
        }}
        sx={{ '& .MuiDataGrid-cell--textRight, & .MuiDataGrid-columnHeader--alignRight': { fontVariantNumeric: 'tabular-nums' } }}
        {...props}
      />
    </Paper>
  );
}
