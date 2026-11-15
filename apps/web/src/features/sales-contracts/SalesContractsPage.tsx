import { MouseEvent, useEffect, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Link, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { GridColDef, GridSortModel } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../../services/api-client';
import { DataTable, ListPageLayout, PageBreadcrumbs } from '../../shared/components';
import { pagePath } from '../../shared/navigation';
import { fmtDate, fmtDay } from '../../shared/utils/format';
import { useMe } from '../identity';
import { ScDetailView } from './ScDetailView';
import { ScStatusDialog } from './ScDialogs';
import { ScHeaderDialog } from './ScHeaderDialog';
import { ScListFilters } from './ScListFilters';
import { ScRowMenu } from './ScRowMenu';
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
  const [statusAction, setStatusAction] = useState<{ row: ScRow; kind: 'activate' | 'cancel' } | null>(null);
  const narrow = useMediaQuery('(max-width:599.95px)');
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
      // On a phone the customer moves under the number, so number, customer, status and actions fit without scrolling.
      field: 'documentNumber', headerName: t('sc.number'), width: 160, ...(narrow ? { flex: 1, minWidth: 140 } : {}),
      renderCell: (p) => (
        <Stack sx={{ justifyContent: 'center', height: '100%', minWidth: 0 }}>
          <Link component={RouterLink} to={toDetail(p.row.id)} onClick={stop} sx={{ fontWeight: 600, lineHeight: 1.4 }}>{p.value}</Link>
          {narrow && <Typography variant="body2" color="text.secondary" noWrap>{p.row.customerName}</Typography>}
        </Stack>
      ),
    },
    { field: 'customerName', headerName: t('sc.customer'), flex: 1, minWidth: 180, sortable: false },
    { field: 'responsibleSalesName', headerName: t('sc.responsibleSales'), width: 180, sortable: false, valueFormatter: (v: string | null) => v ?? t('sc.noResponsibleSales') },
    { field: 'status', headerName: t('common.status'), width: narrow ? 104 : 120, sortable: false, renderCell: (p) => <ScStatusChip status={p.value} /> },
    { field: 'lineCount', headerName: t('sc.lineCount'), type: 'number', width: 90, sortable: false },
    { field: 'pendingProposals', headerName: t('sc.pendingShort'), type: 'number', width: 120, sortable: false },
    {
      field: 'createdAt', headerName: t('sc.createdShort'), width: 120,
      renderCell: (p) => <Tooltip title={fmtDate(p.value)}><span>{fmtDay(p.value)}</span></Tooltip>,
    },
  ];
  // Every row: one ⋯ menu in a fixed, right-aligned cell (ScRowMenu decides which items show or are disabled).
  columns.push({
    field: 'actions', headerName: t('common.actions'), width: 88, sortable: false, align: 'right', headerAlign: 'right',
    renderCell: (p) => (
      <ScRowMenu row={p.row} canManage={manage} onAction={(a) => {
        if (a === 'view') navigate(toDetail(p.row.id));
        else if (a === 'edit') setEditing(p.row);
        else setStatusAction({ row: p.row, kind: a });
      }} />
    ),
  });
  const sortModel: GridSortModel = [{ field: sort, sort: order }];
  const open = (field: string, id: number, target: EventTarget) => {
    if (field === 'actions' || (target as HTMLElement).closest('a')) return; // links and action buttons handle themselves
    navigate(toDetail(id));
  };

  const toolbar = (
    <ScListFilters text={text} onText={setText} params={params} update={update}
      salesOptions={salesUsers.data?.map((u) => ({ value: String(u.id), label: u.fullName }))}
      customerOptions={customers.data?.map((c) => ({ value: String(c.id), label: `${c.code}: ${c.name}` }))} />
  );

  return (
    <ListPageLayout fill title={t('nav.salesContracts')} toolbar={toolbar} error={list.error}
      breadcrumbs={<PageBreadcrumbs items={[{ label: t('common.home'), to: '/' }, { label: t('nav.sales') }, { label: t('nav.salesContracts') }]} />}
      actions={manage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>{t('sc.create')}</Button>}>
      <DataTable
        fill rows={list.data?.items ?? []} rowCount={list.data?.total ?? 0} columns={columns} loading={list.isFetching} emptyHint={t('sc.empty')}
        paginationMode="server" sortingMode="server" disableColumnFilter
        paginationModel={{ page: page - 1, pageSize }} onPaginationModelChange={(m) => update({ page: m.page + 1, pageSize: m.pageSize === PAGE_SIZE ? null : m.pageSize })}
        sortModel={sortModel} sortingOrder={['desc', 'asc']}
        onSortModelChange={(m) => update({ sort: m[0]?.field === 'documentNumber' ? 'documentNumber' : null, order: m[0]?.sort === 'asc' ? 'asc' : null })}
        onCellClick={(p, e) => open(p.field, Number(p.id), e.target)}
        onCellKeyDown={(p, e) => { if (e.key === 'Enter') open(p.field, Number(p.id), e.target); }}
        columnVisibilityModel={narrow ? { customerName: false, responsibleSalesName: false, lineCount: false, pendingProposals: false, createdAt: false } : undefined}
        rowHeight={narrow ? 60 : undefined}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
      />
      {creating && <ScHeaderDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(toDetail(id))} />}
      {editing && <ScHeaderDialog edit={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      {statusAction && (
        <ScStatusDialog id={statusAction.row.id} kind={statusAction.kind} onClose={() => setStatusAction(null)}
          onDone={() => { setStatusAction(null); void list.refetch(); }} />
      )}
    </ListPageLayout>
  );
}
