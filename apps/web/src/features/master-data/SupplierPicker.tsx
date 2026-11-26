import { useState } from 'react';
import { Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, catalogSelectionPath } from '../../services/api-client';
import { pickerSelectionColumn } from '../../shared/components/PickerSelection';
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
  const changeSelection = (items: Entry[], checked: boolean) => setPicked(previous => {
    const next = new Map(previous);
    for (const item of items) {
      if (checked) next.set(item.id, item); else next.delete(item.id);
    }
    return next;
  });
  return <FormDialog title={t('master.chooseSupplier')} submitAction="confirm" submitLabel={t('dossier.confirm', { count: selected.length })}
    canSubmit={selected.length > 0 && !query.isFetching && !query.error} pending={false} error={query.error} pageGuardsNavigation
    footerAside={t('master.selectedSuppliers', { count: selected.length })} onClose={onClose} onSubmit={() => onConfirm(selected)}>
    <Stack spacing={1}>
      <FilterToolbar refreshing={query.isFetching} onRefresh={() => {
        setSearch(''); setPage(model => ({ ...model, page: 0 })); void query.refetch();
      }}>
        <SearchInput label={t('master.search')} placeholder={t('searchFields.codeOrName')} value={search}
          onChange={value => { setSearch(value); setPage(model => ({ ...model, page: 0 })); }} sx={{ flex: '1 1 220px' }} />
      </FilterToolbar>
      <DataTable rows={rows} loading={query.isFetching} maxHeight="min(42dvh, 430px)" paginationModel={page} onPaginationModelChange={setPage}
        getRowClassName={({ id }) => picked.has(Number(id)) ? 'common-grid-selected' : ''}
        columns={[
          pickerSelectionColumn<Entry>(row => picked.has(row.id), changeSelection, row => row.code, query.isFetching),
          { field: 'code', headerName: t('master.supplierCode'), width: 150 },
          { field: 'name', headerName: t('master.supplierName'), flex: 1, minWidth: 180 },
        ]} />
    </Stack>
  </FormDialog>;
}
