import { useTranslation } from 'react-i18next';
import { Paper, Stack, Typography, useMediaQuery } from '@mui/material';
import { fillMedia } from '../../config/theme';
import { DataGrid, DataGridProps, GridValidRowModel } from '@mui/x-data-grid';

/**
 * Standard data table: 44px rows from the theme, bordered surface, localized empty state with a hint.
 * `fill` (inside a fill page, e.g. ListPageLayout fill): on fill screens the grid keeps its natural height for a few
 * rows and, with many, takes the remaining height and scrolls its rows under sticky headers; elsewhere it grows with
 * its rows and the main area scrolls.
 */
export function DataTable<R extends GridValidRowModel>({ emptyHint, fill, ...props }: DataGridProps<R> & { emptyHint?: string; fill?: boolean }) {
  const { t } = useTranslation();
  const filling = useMediaQuery(fillMedia.replace('@media ', '')) && Boolean(fill);
  return (
    <Paper data-fill-grow={fill ? '' : undefined}
      sx={{ overflow: 'hidden', '& .MuiDataGrid-root': { border: 0 }, ...(filling && { display: 'flex', flexDirection: 'column', flex: '0 1 auto', minHeight: 0 }) }}>
      <DataGrid
        autoHeight={!filling}
        disableRowSelectionOnClick
        disableColumnMenu
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
