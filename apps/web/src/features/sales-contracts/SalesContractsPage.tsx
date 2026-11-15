import { MouseEvent, useEffect, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, IconButton, InputAdornment, Link, Menu, MenuItem, Stack, TextField, Tooltip } from '@mui/material';
import { GridColDef, GridSortModel } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditOutlined from '@mui/icons-material/EditOutlined';
import MoreVert from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../../services/api-client';
import { DataTable, ListPageLayout, PageBreadcrumbs } from '../../shared/components';
import { pagePath } from '../../shared/navigation';
import { fmtDate } from '../../shared/utils/format';
import { useMe } from '../identity';
import { ScDetailView } from './ScDetailView';
import { ScStatusDialog } from './ScDialogs';
import { ScHeaderDialog } from './ScHeaderDialog';
import { ScStatusChip } from './ScStatusChip';
import { rememberListSearch, ScRow } from './types';

/** `/sales-contracts` lists, `/sales-contracts/:id` opens one contract (the id comes from the route). */
export function SalesContractsPage({ initialId }: { initialId?: number } = {}) {
  return initialId ? <ScDetailView id={initialId} /> : <ScListView />;
}

const PAGE_SIZE = 25;
const toDetail = (id: number) => pagePath('salesContracts', id);

/** Search/filter/sort/page run on the server and live in the URL, so they survive opening a contract and coming back. */
function ScListView() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScRow | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; row: ScRow } | null>(null);
  const [statusAction, setStatusAction] = useState<{ row: ScRow; kind: 'activate' | 'cancel' } | null>(null);
  const can = (p: string) => Boolean(me.data?.permissions.includes(p));
  const manage = can('SALES_CONTRACT.CREATE');

  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? PAGE_SIZE);
  const sort = params.get('sort') === 'documentNumber' ? 'documentNumber' : 'createdAt';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';
  const update = (next: Record<string, string | number | null>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v === null || v === '' ? p.delete(k) : p.set(k, String(v))));
    if (!('page' in next)) p.delete('page'); // a new filter starts from page 1
    setParams(p, { replace: true });
  };
  useEffect(() => { rememberListSearch(location.search); }, [location.search]);
  useEffect(() => {
    const h = setTimeout(() => { if (text.trim() !== (params.get('q') ?? '')) update({ q: text.trim() }); }, 300);
    return () => clearTimeout(h);
  }, [text]); // debounced on typing only

  const query = new URLSearchParams(params);
  query.set('page', String(page));
  query.set('pageSize', String(pageSize));
  const list = useQuery({
    queryKey: ['scs', query.toString()],
    queryFn: () => api<{ items: ScRow[]; total: number }>(`/sales-contracts?${query}`),
    placeholderData: keepPreviousData,
  });
  // Filter options: candidates need SALES_CONTRACT.CREATE and customers CUSTOMER.VIEW; a filter without options is hidden.
  const salesUsers = useQuery({ queryKey: ['responsible-sales'], queryFn: () => api<{ id: number; fullName: string }[]>('/sales-contracts/responsible-sales-candidates'), enabled: manage });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api<{ id: number; code: string; name: string }[]>('/customers'), enabled: can('CUSTOMER.VIEW') });

  const stop = (e: MouseEvent) => e.stopPropagation();
  const columns: GridColDef<ScRow>[] = [
    {
      field: 'documentNumber', headerName: t('sc.number'), width: 170,
      renderCell: (p) => <Link component={RouterLink} to={toDetail(p.row.id)} onClick={stop} sx={{ fontWeight: 600 }}>{p.value}</Link>,
    },
    { field: 'status', headerName: t('common.status'), width: 120, sortable: false, renderCell: (p) => <ScStatusChip status={p.value} /> },
    { field: 'customerName', headerName: t('sc.customer'), flex: 1, minWidth: 180, sortable: false },
    { field: 'responsibleSalesName', headerName: t('sc.responsibleSales'), width: 170, sortable: false, valueFormatter: (v: string | null) => v ?? t('sc.noResponsibleSales') },
    { field: 'lineCount', headerName: t('sc.lineCount'), type: 'number', width: 90, sortable: false },
    { field: 'pendingProposals', headerName: t('sc.pendingProposals'), type: 'number', width: 150, sortable: false },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 160, valueFormatter: fmtDate },
  ];
  if (manage) {
    columns.push({
      field: 'actions', headerName: t('common.actions'), width: 100, sortable: false, align: 'right', headerAlign: 'right',
      renderCell: (p) => p.row.status !== 'CANCELED' && (
        <Stack direction="row" onClick={stop}>
          {p.row.status === 'DRAFT' && (
            <Tooltip title={t('sc.editHeader')}>
              <IconButton size="small" aria-label={`${t('sc.editHeader')} ${p.row.documentNumber}`} onClick={() => setEditing(p.row)}><EditOutlined fontSize="small" /></IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('common.more')}>
            <IconButton size="small" aria-label={`${t('common.more')} ${p.row.documentNumber}`} aria-haspopup="menu"
              onClick={(e) => setMenu({ anchor: e.currentTarget, row: p.row })}><MoreVert fontSize="small" /></IconButton>
          </Tooltip>
        </Stack>
      ),
    });
  }
  const sortModel: GridSortModel = [{ field: sort, sort: order }];
  const open = (field: string, id: number, target: EventTarget) => {
    if (field === 'actions' || (target as HTMLElement).closest('a')) return; // links and action buttons handle themselves
    navigate(toDetail(id));
  };

  const toolbar = (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
      <TextField size="small" label={t('common.search')} placeholder={t('sc.search')} value={text} onChange={(e) => setText(e.target.value)} sx={{ minWidth: { md: 280 } }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
      <TextField size="small" select label={t('common.status')} value={params.get('status') ?? ''} onChange={(e) => update({ status: e.target.value })} sx={{ minWidth: 150 }}>
        <MenuItem value="">{t('common.all')}</MenuItem>
        {['DRAFT', 'ACTIVE', 'CANCELED'].map((s) => <MenuItem key={s} value={s}>{t(`sc.status.${s}`)}</MenuItem>)}
      </TextField>
      {salesUsers.data && (
        <TextField size="small" select label={t('sc.responsibleSales')} value={params.get('responsibleSalesUserId') ?? ''} onChange={(e) => update({ responsibleSalesUserId: e.target.value })} sx={{ minWidth: 180 }}>
          <MenuItem value="">{t('common.all')}</MenuItem>
          {salesUsers.data.map((u) => <MenuItem key={u.id} value={String(u.id)}>{u.fullName}</MenuItem>)}
        </TextField>
      )}
      {customers.data && (
        <TextField size="small" select label={t('sc.customer')} value={params.get('customerId') ?? ''} onChange={(e) => update({ customerId: e.target.value })} sx={{ minWidth: 200 }}>
          <MenuItem value="">{t('common.all')}</MenuItem>
          {customers.data.map((c) => <MenuItem key={c.id} value={String(c.id)}>{c.code}: {c.name}</MenuItem>)}
        </TextField>
      )}
    </Stack>
  );

  return (
    <ListPageLayout title={t('nav.salesContracts')} toolbar={toolbar} error={list.error}
      breadcrumbs={<PageBreadcrumbs items={[{ label: t('common.home'), to: '/' }, { label: t('nav.sales') }, { label: t('nav.salesContracts') }]} />}
      actions={manage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>{t('sc.create')}</Button>}>
      <DataTable
        rows={list.data?.items ?? []} rowCount={list.data?.total ?? 0} columns={columns} loading={list.isFetching} emptyHint={t('sc.empty')}
        paginationMode="server" sortingMode="server" disableColumnFilter
        paginationModel={{ page: page - 1, pageSize }} onPaginationModelChange={(m) => update({ page: m.page + 1, pageSize: m.pageSize === PAGE_SIZE ? null : m.pageSize })}
        sortModel={sortModel} sortingOrder={['desc', 'asc']}
        onSortModelChange={(m) => update({ sort: m[0]?.field === 'documentNumber' ? 'documentNumber' : null, order: m[0]?.sort === 'asc' ? 'asc' : null })}
        onCellClick={(p, e) => open(p.field, Number(p.id), e.target)}
        onCellKeyDown={(p, e) => { if (e.key === 'Enter') open(p.field, Number(p.id), e.target); }}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
      />
      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu?.row.status === 'DRAFT' && <MenuItem onClick={() => { setStatusAction({ row: menu.row, kind: 'activate' }); setMenu(null); }}>{t('sc.activate')}</MenuItem>}
        {menu && <MenuItem sx={{ color: 'error.main' }} onClick={() => { setStatusAction({ row: menu.row, kind: 'cancel' }); setMenu(null); }}>{t('sc.cancel')}</MenuItem>}
      </Menu>
      {creating && <ScHeaderDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(toDetail(id))} />}
      {editing && <ScHeaderDialog edit={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      {statusAction && (
        <ScStatusDialog id={statusAction.row.id} kind={statusAction.kind} onClose={() => setStatusAction(null)}
          onDone={() => { setStatusAction(null); void list.refetch(); }} />
      )}
    </ListPageLayout>
  );
}
