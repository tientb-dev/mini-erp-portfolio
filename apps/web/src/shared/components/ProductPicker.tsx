import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { GridColDef, GridPaginationModel, GridSortModel } from '@mui/x-data-grid';
import Check from '@mui/icons-material/Check';
import Close from '@mui/icons-material/Close';
import Refresh from '@mui/icons-material/Refresh';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api-client';
import { DataTable, FilterToolbar, GridText } from './index';
import { useDebouncedText, useServerList } from '../utils/server-list';

export interface PickerProduct {
  id: number; code: string; name: string; description?: string; brandId?: number; brand?: string;
  unitOfMeasureId?: number; uom?: string; source: 'main' | 'temporary';
}
type Source = PickerProduct['source'];
interface Filters { q: string; brand: string; page: GridPaginationModel; sort: GridSortModel }
const defaults = (): Filters => ({ q: '', brand: '', page: { page: 0, pageSize: 25 }, sort: [{ field: 'code', sort: 'asc' }] });
const keyOf = (source: Source, id: number) => source + ':' + id;

export function ProductPicker({ onClose, onConfirm }: { onClose: () => void; onConfirm: (items: PickerProduct[]) => void }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>('main');
  const [filters, setFilters] = useState({ main: defaults(), temporary: defaults() });
  const [picked, setPicked] = useState(new Map<string, PickerProduct>());
  const f = filters[source];
  const q = useDebouncedText(f.q);
  const params = new URLSearchParams({ q, page: String(f.page.page + 1), size: String(f.page.pageSize),
    sort: f.sort[0]?.field ?? 'code', direction: f.sort[0]?.sort ?? 'asc' });
  if (source === 'main' && f.brand) params.set('brandId', f.brand);
  const rows = useServerList<PickerProduct>('/product-picker/' + source, params, q === f.q);
  const brands = useQuery({ queryKey: ['brands','picker'], queryFn: () => api<{id: number; name: string}[]>('/brands?activeOnly=true') });
  const items = rows.isPlaceholderData ? [] : rows.data?.items ?? [];
  const count = items.filter(item => picked.has(keyOf(source, item.id))).length;
  const mainCount = [...picked.values()].filter(item => item.source === 'main').length;
  function change(value: Partial<Filters>) { setFilters(previous => ({ ...previous, [source]: { ...previous[source], ...value } })); }
  function select(values: PickerProduct[], checked: boolean) {
    setPicked(previous => {
      const next = new Map(previous);
      for (const item of values) {
        const key = keyOf(source, item.id);
        if (checked) next.set(key, { ...item, source }); else next.delete(key);
      }
      return next;
    });
  }
  const columns: GridColDef<PickerProduct>[] = [
    { field: 'selection', width: 54, sortable: false, filterable: false, disableColumnMenu: true, headerName: '', align: 'center', headerAlign: 'center', cellClassName: 'picker-selection', renderHeader: () =>
      <Checkbox size="small" checked={count > 0 && count === items.length} indeterminate={count > 0 && count < items.length}
        slotProps={{ input: { 'aria-label': t('prPhase.selectPage') } }} disabled={!items.length} onChange={e => select(items, e.target.checked)} />,
      renderCell: p => <Checkbox size="small" checked={picked.has(keyOf(source, p.row.id))} onChange={e => select([p.row], e.target.checked)}
        slotProps={{ input: { 'aria-label': p.row.code, tabIndex: p.tabIndex } }} /> },
    { field: 'code', headerName: t('prPhase.itemCode'), width: 180, renderCell: p => <GridText value={p.row.code} tabIndex={p.tabIndex} /> },
    { field: 'name', headerName: t('product.name'), minWidth: 235, flex: 2 },
    ...(source === 'main' ? [{ field: 'brand', headerName: t('prPhase.brand'), minWidth: 150, flex: 1 }, { field: 'uom', headerName: t('product.uom'), width: 140 }]
      : [{ field: 'description', headerName: t('prPhase.description'), minWidth: 215, flex: 2 }]),
  ];
  return <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 1100, maxWidth: '95vw', m: 1 } } }}>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
      {t('prPhase.picker')}<IconButton color="inherit" onClick={onClose} aria-label={t('common.cancel')}><Close /></IconButton>
    </DialogTitle>
    <DialogContent dividers sx={{ overflow: 'hidden', p: 1.5 }}>
      <Tabs value={source} onChange={(_, value: Source) => setSource(value)} sx={{ mb: 1 }}>
        <Tab value="main" label={t('prPhase.main')} /><Tab value="temporary" label={t('prPhase.temporary')} />
      </Tabs>
      <FilterToolbar>
        <TextField label={t('prPhase.itemSearch')} size="small" value={f.q} onChange={e => change({ q: e.target.value, page: { ...f.page, page: 0 } })} sx={{ width: 260 }} />
        {source === 'main' && <TextField select size="small" label={t('prPhase.brand')} value={f.brand}
          onChange={e => change({ brand: e.target.value, page: { ...f.page, page: 0 } })} sx={{ width: 180 }}>
          <MenuItem value="">{t('common.all')}</MenuItem>
          {brands.data?.map(b => <MenuItem key={b.id} value={String(b.id)}>{b.name}</MenuItem>)}
        </TextField>}
        <Tooltip title={t('prPhase.refreshHint')}><Button startIcon={<Refresh />} variant="outlined" sx={{ ml: 'auto' }}
          onClick={() => { if (JSON.stringify(f) === JSON.stringify(defaults())) void rows.refetch(); change(defaults()); }}>{t('prPhase.refresh')}</Button></Tooltip>
      </FilterToolbar>
      <Box sx={{ mt: 1.5, '& .MuiDataGrid-root': { height: 'min(48vh, 510px)' } }}>
        <DataTable columns={columns} rows={items} rowCount={rows.data?.total ?? 0} loading={rows.isFetching || q !== f.q}
          error={rows.error} sx={{ '& .picker-selection': { display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0, textOverflow: 'clip' } }} maxHeight="min(48vh, 510px)" paginationMode="server" sortingMode="server"
          paginationModel={f.page} sortModel={f.sort} onPaginationModelChange={page => change({ page })}
          onSortModelChange={sort => change({ sort, page: { ...f.page, page: 0 } })} />
      </Box>
    </DialogContent>
    <DialogActions sx={{ justifyContent: 'space-between', flexWrap: 'wrap', px: 2 }}>
      <Stack direction="row" spacing={2}><Typography sx={{ fontWeight: 700 }}>{t('prPhase.selected', { count: picked.size })}</Typography>
        <Typography color="text.secondary">{mainCount} {t('prPhase.main')} · {picked.size - mainCount} {t('prPhase.temporary')}</Typography></Stack>
      <Stack direction="row" spacing={1}><Button variant="outlined" startIcon={<Close />} onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" startIcon={<Check />} disabled={!picked.size} onClick={() => onConfirm([...picked.values()])}>
          {t('prPhase.confirm')} ({picked.size})
        </Button></Stack>
    </DialogActions>
  </Dialog>;
}
