import { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconButton, Paper, Stack, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import Up from '@mui/icons-material/ArrowUpward';
import Down from '@mui/icons-material/ArrowDownward';
import Delete from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '../../services/api-client';
import { ActionResultDialog, DataTable, DetailPageLayout, FilterToolbar, FormDialog, GridText, ListPageLayout, ScrollTable, StatusChip } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { DiscardDialog, RouteDiscardGuard } from '../../shared/components/FormDialog';
import { pickerSelectionColumn } from '../../shared/components/PickerSelection';
import { SearchInput } from '../../shared/components/SearchInput';
import { ActionButton } from '../../shared/components/ActionButton';

const path = '/dossier-configurations';
const labels: Record<string, string> = {
  PR: 'pr.title', PO: 'po.title', GRR: 'grr.title', GIR: 'gir.title', GR: 'gr.title', GI: 'gi.title', SALES_CONTRACT: 'nav.salesContracts',
};
const displayCode = (type: string) => type === 'SALES_CONTRACT' ? 'SC' : type;
function documentName(t: TFunction, type: string) {
  const name = t(labels[type] ?? type, { defaultValue: type });
  const suffix = ` (${displayCode(type)})`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
type Entry = { id: number; code: string; name: string; isActive: boolean };
type Configuration = { version: number; items: Entry[] };
type Summary = { documentType: string; count: number };

export function DossierConfigurationsPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: [path], queryFn: () => api<Summary[]>(path) });
  const columns: GridColDef<Summary>[] = [
    { field: 'documentType', headerName: t('dossier.documentCode'), width: 190, renderCell: p =>
      <GridText value={displayCode(p.row.documentType)} to={path + '/' + p.row.documentType} tabIndex={p.tabIndex} /> },
    { field: 'name', headerName: t('dossier.documentName'), flex: 1, minWidth: 240,
      valueGetter: (_, row) => documentName(t, row.documentType) },
    { field: 'count', headerName: t('dossier.configuredCount'), width: 180, type: 'number' },
  ];
  return <ListPageLayout title={t('dossier.configurations')} error={query.error}>
    <DataTable rows={query.data ?? []} getRowId={row => row.documentType} columns={columns} hideFooter loading={query.isPending} />
  </ListPageLayout>;
}

export function DossierConfigurationRoute() {
  const { documentType } = useParams();
  return <DossierConfigurationPage key={documentType} documentType={documentType ?? ''} />;
}

export function DossierConfigurationPage({ documentType }: { documentType: string }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: [path, documentType], queryFn: () => api<Configuration>(path + '/' + encodeURIComponent(documentType)) });
  const name = documentName(t, documentType);
  const title = t('dossier.detail', { name, code: displayCode(documentType) });
  if (!query.data) return <DetailPageLayout title={title} backTo={path} loading={query.isPending} error={query.error} />;
  return <ConfigurationEditor documentType={documentType} title={title} initial={query.data} />;
}

function ConfigurationEditor({ documentType, title, initial }: { documentType: string; title: string; initial: Configuration }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useContext(UNSAFE_DataRouterContext);
  const qc = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [items, setItems] = useState(initial.items);
  const [picker, setPicker] = useState(false);
  const [result, setResult] = useState<ActionResult>();
  const [discard, setDiscard] = useState(false);
  const allowNavigation = useRef(false);
  const dirty = saved.items.length !== items.length || items.some((item, i) => saved.items[i]?.id !== item.id);
  const save = useMutation({
    mutationFn: () => api(path + '/' + documentType, { method: 'PUT', body: JSON.stringify({
      version: saved.version, dossierTypeIds: items.map(item => item.id),
    }) }),
    onSuccess: () => {
      const configuration = { version: saved.version + 1, items };
      setSaved(configuration);
      qc.setQueryData([path, documentType], configuration);
      void qc.invalidateQueries({ queryKey: [path], exact: true });
      setResult({ success: true, message: t('dossier.saved') });
    },
    onError: error => setResult({ success: false, error, message: t('dossier.saveFailed') }),
  });
  useEffect(() => {
    if (!dirty && !save.isPending) {
      setSaved(initial);
      setItems(initial.items);
    }
  }, [initial, dirty, save.isPending]);
  useEffect(() => {
    if (!dirty && !save.isPending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, save.isPending]);
  function back() {
    if (save.isPending) return;
    if (dirty) setDiscard(true);
    else navigate(path);
  }
  function move(index: number, delta: number) {
    setItems(previous => {
      const next = [...previous];
      const destination = index + delta;
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }
  const controlsDisabled = save.isPending || Boolean(result);
  return <>
    <DetailPageLayout title={title} onBack={back} backLabel={t('dossier.back')} naturalFlow
      footer={<Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <ActionButton action="cancel" disabled={controlsDisabled} onClick={back}>{t('common.cancel')}</ActionButton>
        <ActionButton action="save" disabled={!dirty || controlsDisabled}
          onClick={() => save.mutate()}>{t('dossier.save')}</ActionButton>
      </Stack>}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography component="h2" variant="h2">{t('dossier.applied')}</Typography>
        <ActionButton action="add" disabled={controlsDisabled} onClick={() => setPicker(true)}>{t('dossier.addType')}</ActionButton>
      </Stack>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}><ScrollTable label={t('dossier.applied')} columnWidths={[68, 180, 440, 145]} maxHeight="min(51dvh, 530px)">
        <TableHead><TableRow><TableCell>{t('prPhase.row')}</TableCell><TableCell>{t('dossier.typeCode')}</TableCell>
          <TableCell>{t('dossier.typeName')}</TableCell><TableCell data-grid-actions>{t('common.actions')}</TableCell></TableRow></TableHead>
        <TableBody>
          {items.length === 0 && <TableRow><TableCell colSpan={4}>{t('dossier.empty')}</TableCell></TableRow>}
          {items.map((item, index) => <TableRow key={item.id}>
            <TableCell>{index + 1}</TableCell><TableCell><GridText value={item.code} /></TableCell>
            <TableCell><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><GridText value={item.name} />
              {!item.isActive && <StatusChip label={t('master.inactive')} tone="neutral" />}</Stack></TableCell>
            <TableCell data-grid-actions><Stack direction="row">
              {([{ key: 'up', icon: <Up fontSize="small" />, delta: -1 }, { key: 'down', icon: <Down fontSize="small" />, delta: 1 }] as const).map(action =>
                <Tooltip key={action.key} title={t('dossier.' + action.key)}><span><IconButton size="small"
                  aria-label={t('dossier.' + action.key) + ' ' + item.code}
                  disabled={controlsDisabled || index + action.delta < 0 || index + action.delta >= items.length}
                  onClick={() => move(index, action.delta)}>{action.icon}</IconButton></span></Tooltip>)}
              <Tooltip title={t('dossier.remove')}><IconButton size="small" color="error" disabled={controlsDisabled}
                aria-label={t('dossier.remove') + ' ' + item.code} onClick={() => setItems(previous => previous.filter(row => row.id !== item.id))}>
                <Delete fontSize="small" /></IconButton></Tooltip>
            </Stack></TableCell>
          </TableRow>)}
        </TableBody>
      </ScrollTable></Paper>
      <Typography variant="body2" color="text.secondary">{t('dossier.count', { count: items.length })}</Typography>
    </DetailPageLayout>
    {router && <RouteDiscardGuard dirty={dirty} pending={save.isPending} allowNavigation={() => allowNavigation.current} />}
    {discard && <DiscardDialog onKeep={() => setDiscard(false)} onDiscard={() => { allowNavigation.current = true; navigate(path); }} />}
    {picker && <DossierTypePicker exclude={new Set(items.map(item => item.id))} onClose={() => setPicker(false)}
      onConfirm={selected => { setItems(previous => [...previous, ...selected]); setPicker(false); }} />}
    {result && <ActionResultDialog result={result} onClose={() => setResult(undefined)} />}
  </>;
}

function DossierTypePicker({ exclude, onClose, onConfirm }: {
  exclude: ReadonlySet<number>; onClose: () => void; onConfirm: (items: Entry[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState({ page: 0, pageSize: 25 });
  const [selected, setSelected] = useState(new Map<number, Entry>());
  const query = useQuery({ queryKey: [path, 'catalog'], queryFn: () => api<Entry[]>(path + '/catalog') });
  const keyword = search.trim().toLocaleLowerCase();
  const rows = (query.data ?? []).filter(item => item.isActive && !exclude.has(item.id)
    && [item.code, item.name].some(value => value.toLocaleLowerCase().includes(keyword)));
  const changeSelection = (items: Entry[], checked: boolean) => setSelected(previous => {
    const next = new Map(previous);
    for (const item of items) {
      if (checked) next.set(item.id, item); else next.delete(item.id);
    }
    return next;
  });
  const columns: GridColDef<Entry>[] = [
    pickerSelectionColumn<Entry>(row => selected.has(row.id), changeSelection, row => row.code, query.isFetching),
    { field: 'code', headerName: t('dossier.typeCode'), width: 150 },
    { field: 'name', headerName: t('dossier.typeName'), minWidth: 200, flex: 1 },
  ];
  return <FormDialog title={t('dossier.choose')} submitLabel={t('dossier.confirm', { count: selected.size })} submitAction="confirm"
    pending={false} canSubmit={selected.size > 0 && !query.isError} error={query.error} onClose={onClose}
    footerAside={t('dossier.selected', { count: selected.size })} onSubmit={() => onConfirm([...selected.values()])}>
    <FilterToolbar refreshing={query.isFetching}
      onRefresh={() => { setSearch(''); setPage({ page: 0, pageSize: 25 }); void query.refetch(); }}>
      <SearchInput label={t('common.search')} value={search} placeholder={t('searchFields.catalog.dossierTypes')}
        onChange={value => { setSearch(value); setPage(previous => ({ ...previous, page: 0 })); }} sx={{ flex: '1 1 200px' }} />
    </FilterToolbar>
    <DataTable rows={rows} columns={columns} loading={query.isFetching} maxHeight="min(48dvh, 470px)"
      paginationModel={page} onPaginationModelChange={setPage}
      getRowClassName={({ row }) => selected.has(row.id) ? 'common-grid-selected' : ''} />
  </FormDialog>;
}
