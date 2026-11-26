import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, CircularProgress, Paper, Stack, Typography, useMediaQuery } from '@mui/material';
import { fillMedia, tokens } from '../../config/theme';
import { GridText } from './GridText';
import { DataGrid, GridColDef, DataGridProps, GridValidRowModel } from '@mui/x-data-grid';

/**
 * Standard data table: 44px rows from the theme, bordered surface, localized empty state with a hint.
 * `fill` (inside a fill page, e.g. ListPageLayout fill): on fill screens the grid keeps its natural height for a few
 * rows and, with many, takes the remaining height and scrolls its rows under sticky headers; elsewhere it grows with
 * its rows and the main area scrolls.
 * Loading (pass the query's `isFetching`): a light overlay with a spinner over the previous rows (kept underneath, no
 * empty state, no layout jump) and pagination locked until the request settles.
 * `error`: the rows are cleared and the table says the data could not be loaded (the page shows the API detail).
 */
export function DataTable<R extends GridValidRowModel>({ emptyHint, fill, error, maxHeight, columns, ...props }: DataGridProps<R> & {
  emptyHint?: string; fill?: boolean; error?: unknown; maxHeight?: string;
}) {
  const { t } = useTranslation();
  const filling = useMediaQuery(fillMedia.replace('@media ', '')) && Boolean(fill);
  const bounded = filling || Boolean(maxHeight);
  const hasActions = columns.at(-1)?.field === 'actions';
  const displayColumns = useMemo(() => columns.map((column): GridColDef<R> => {
    if (column.field === 'actions' && hasActions) return { ...column, cellClassName: 'common-grid-actions', headerClassName: 'common-grid-actions' };
    if (column.renderCell || (column.type && !['string', 'number'].includes(column.type))) return column;
    return {
      ...column,
      renderCell: params => <GridText value={String(params.formattedValue ?? params.value ?? '')} tabIndex={params.tabIndex} />,
    };
  }), [columns, hasActions]);
  const loading = Boolean(props.loading);
  const failed = Boolean(error) && !loading;
  const onPage = props.onPaginationModelChange;
  // Keep the last known total on error: a 0 rowCount would make the grid jump back to page 1 by itself.
  const lastRowCount = useRef(props.rowCount);
  if (!failed && props.rowCount !== undefined) lastRowCount.current = props.rowCount;
  // While loading, pagination keeps describing the rows on screen; it moves to the new page together with its data.
  const shownModel = useRef(props.paginationModel);
  if (!loading) shownModel.current = props.paginationModel;
  const message = (
    <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
      <Typography variant="body2" color={failed ? 'error' : 'text.secondary'}>{failed ? t('common.loadFailed') : emptyHint ?? t('common.empty')}</Typography>
    </Stack>
  );
  return (
    <Paper data-fill-grow={fill ? '' : undefined}
      sx={{ position: 'relative', overflow: 'hidden', '& .MuiDataGrid-root': { border: 0 }, ...(bounded && { display: 'flex', flexDirection: 'column', flex: '0 1 auto', minHeight: 0, maxHeight }) }}>
      <DataGrid
        autoHeight={!bounded}
        columns={displayColumns}
        columnBufferPx={hasActions ? columns.reduce((width, column) => width + Math.max(column.width ?? 100, column.minWidth ?? 0), 0) : undefined}
        disableRowSelectionOnClick
        disableColumnMenu
        pageSizeOptions={[25, 50, 100]}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        slots={{
          noRowsOverlay: () => message,
          noResultsOverlay: () => message,
          // The grid stays in loading mode (no empty state) but draws nothing; the veil below covers the rows area.
          loadingOverlay: () => null,
        }}
        {...props}
        getRowClassName={params => [params.indexRelativeToCurrentPage % 2 ? 'common-grid-even' : '', props.getRowClassName?.(params)].join(' ')}
        // The caller's sx is merged after the table's own, never replacing it (overlay tint, pagination lock).
        sx={[
          {
            '& .MuiDataGrid-row': {
              '--grid-row-bg': tokens.surface,
              bgcolor: 'var(--grid-row-bg)',
              '&.common-grid-even': { '--grid-row-bg': tokens.gridEven },
              '&:hover': { '--grid-row-bg': tokens.gridHover, bgcolor: 'var(--grid-row-bg)' },
              '&.Mui-selected, &.Mui-selected:hover, &.common-grid-selected, &.common-grid-selected:hover': {
                '--grid-row-bg': tokens.gridSelected, bgcolor: 'var(--grid-row-bg)',
              },
            },
            '& .common-picker-check': { display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0, textOverflow: 'clip' },
            '& .MuiDataGrid-cell--textRight, & .MuiDataGrid-columnHeader--alignRight': { fontVariantNumeric: 'tabular-nums' },
            '& .common-grid-actions': { position: 'sticky', right: 0, zIndex: 2, bgcolor: 'var(--grid-row-bg, #fff)', borderLeft: 1, borderColor: tokens.gridSeparator },
            '& .MuiDataGrid-columnHeader.common-grid-actions': { zIndex: 4, bgcolor: tokens.gridHeader },
          },
          loading && { '& .MuiTablePagination-root': { pointerEvents: 'none', opacity: 0.6 } },
          ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
        ]}
        rows={failed ? [] : props.rows}
        rowCount={props.rowCount === undefined ? undefined : lastRowCount.current}
        paginationModel={props.paginationModel && shownModel.current}
        // Locked while a page is loading (keyboard included), so clicks cannot queue up page changes.
        onPaginationModelChange={onPage && ((m, d) => { if (!loading) onPage(m, d); })}
      />
      {loading && (
        // Previous rows stay visible under a light veil between the column headers (40px) and the pagination footer.
        <Box role="progressbar" aria-label={t('common.loading')}
          sx={{ position: 'absolute', left: 0, right: 0, top: 40, bottom: props.hideFooter ? 0 : 52, zIndex: 3,
            display: 'grid', placeItems: 'center', bgcolor: 'rgba(255, 255, 255, 0.6)' }}>
          <CircularProgress size={32} thickness={4} disableShrink />
        </Box>
      )}
    </Paper>
  );
}
