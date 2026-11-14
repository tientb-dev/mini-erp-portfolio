import { useTranslation } from 'react-i18next';
import { Paper, Stack, Typography } from '@mui/material';
import { DataGrid, DataGridProps, GridValidRowModel } from '@mui/x-data-grid';

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
