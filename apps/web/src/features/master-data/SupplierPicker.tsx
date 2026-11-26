import { useState } from 'react';
import { Checkbox, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, catalogSelectionPath } from '../../services/api-client';
import { ActionButton } from '../../shared/components/ActionButton';
import { DataTable, FilterToolbar, FormDialog } from '../../shared/components';
import { SearchInput } from '../../shared/components/SearchInput';
import type { Entry } from './catalogs';

export function SupplierPicker({ excluded, onClose, onConfirm }: {
  excluded: number[]; onClose: () => void; onConfirm: (entries: Entry[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(new Map<number, Entry>());
  const [page, setPage] = useState({ page: 0, pageSize: 25 });
  const query = useQuery({ queryKey: ['suppliers', 'selection'],
    queryFn: () => api<Entry[]>(catalogSelectionPath('/suppliers')) });
  const available = (query.data ?? []).filter(row => !excluded.includes(row.id) && row.isActive);
  const availableIds = new Set(available.map(row => row.id));
  const selected = [...picked.values()].filter(row => availableIds.has(row.id));
  const keyword = search.trim().toLocaleLowerCase();
  const rows = available.filter(row => [row.code ?? '', row.name].some(value => value.toLocaleLowerCase().includes(keyword)));
  return <FormDialog compact title={t('master.chooseSupplier')} submitAction="confirm" submitLabel={t('dossier.confirm', { count: selected.length })}
    canSubmit={selected.length > 0 && !query.isFetching && !query.error} pending={false} error={query.error} pageGuardsNavigation
    footerAside={t('master.selectedSuppliers', { count: selected.length })} onClose={onClose} onSubmit={() => onConfirm(selected)}>
    <Stack spacing={1}>
      <FilterToolbar>
        <SearchInput label={t('master.search')} placeholder={t('searchFields.codeOrName')} value={search}
          onChange={value => { setSearch(value); setPage(model => ({ ...model, page: 0 })); }} sx={{ flex: '1 1 220px' }} />
        <ActionButton action="refresh" disabled={query.isFetching} onClick={() => {
          setSearch(''); setPage(model => ({ ...model, page: 0 })); void query.refetch();
        }}>{t('prPhase.refresh')}</ActionButton>
      </FilterToolbar>
      <DataTable rows={rows} loading={query.isFetching} maxHeight="min(42dvh, 430px)" paginationModel={page} onPaginationModelChange={setPage}
        columns={[
          { field: 'picked', headerName: '', width: 48, sortable: false, renderCell: ({ row, tabIndex }) =>
            <Checkbox size="small" checked={picked.has(row.id)} slotProps={{ input: { 'aria-label': row.code, tabIndex } }}
              onChange={event => setPicked(previous => {
                const next = new Map(previous);
                if (event.target.checked) next.set(row.id, row); else next.delete(row.id);
                return next;
              })} /> },
          { field: 'code', headerName: t('master.supplierCode'), minWidth: 125 },
          { field: 'name', headerName: t('master.supplierName'), flex: 1, minWidth: 180 },
        ]} />
    </Stack>
  </FormDialog>;
}
