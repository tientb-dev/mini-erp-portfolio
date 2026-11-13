import { ComponentType, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { TFunction } from 'i18next';
import { api, Product } from './api';
import { DocAction, DocActionDialog, Field, fmtDate, HistoryEntry, HistoryList, useMe } from './doc-ui';
import { FormDialog } from './pages';
import { ApprovalStatusChip, DataTable, ErrorAlert, PageHeader } from './ui';

/** PR, PO and GRR share one list/detail layout; only the create form and a few header fields differ. */

interface DocRow {
  id: number; documentNumber: string; approvalStatus: string; createdBy: number; createdByName: string;
  assignedApproverId: number | null; assignedApproverName: string | null; createdAt: string; [extra: string]: unknown;
}
interface DocLine { id: number; ref: string; partNumber: string; productName: string; uom: string; quantity: string; usedQuantity?: string }
interface DocDetail extends DocRow { lines: DocLine[]; children: { id: number; documentNumber: string; approvalStatus: string }[]; history: HistoryEntry[] }
interface CreateProps { onClose: () => void; onCreated: (id: number) => void }

interface DocConfig {
  /** i18n namespace and permission prefix. */
  key: 'pr' | 'po' | 'grr'; perm: 'PR' | 'PO' | 'GRR'; path: string;
  columns: (t: TFunction) => GridColDef<DocRow>[];
  fields: (d: DocDetail, t: TFunction) => [string, ReactNode][];
  Create: ComponentType<CreateProps>;
}

const num = (v: string | number) => Number(v);

function DocListPage({ cfg }: { cfg: DocConfig }) {
  const { t } = useTranslation();
  const me = useMe();
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const list = useQuery({ queryKey: [cfg.key, 'list', mine], queryFn: () => api<DocRow[]>(`/${cfg.path}?assignedToMe=${mine}`) });
  if (openId) return <DocDetailView cfg={cfg} id={openId} onBack={() => setOpenId(null)} />;
  const columns: GridColDef<DocRow>[] = [
    { field: 'documentNumber', headerName: t(`${cfg.key}.number`), width: 170 },
    { field: 'approvalStatus', headerName: t('common.status'), width: 150, renderCell: (p) => <ApprovalStatusChip status={p.value} /> },
    ...cfg.columns(t),
    { field: 'createdByName', headerName: t('gr.createdBy'), width: 160 },
    { field: 'assignedApproverName', headerName: t('gr.approver'), flex: 1, minWidth: 140 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  const canCreate = me.data?.permissions.includes(`${cfg.perm}.CREATE`);
  return (
    <>
      <PageHeader title={t(`${cfg.key}.title`)} action={canCreate && <Button variant="contained" onClick={() => setCreating(true)}>{t(`${cfg.key}.create`)}</Button>} />
      <Stack spacing={2}>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label={t('doc.waitingForMe')} />
        <ErrorAlert error={list.error} />
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t(`${cfg.key}.empty`)}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Stack>
      {creating && <cfg.Create onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}

function DocDetailView({ cfg, id, onBack }: { cfg: DocConfig; id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [tab, setTab] = useState(0);
  const [action, setAction] = useState<DocAction | null>(null);
  const doc = useQuery({ queryKey: [cfg.key, id], queryFn: () => api<DocDetail>(`/${cfg.path}/${id}`) });
  if (!doc.data || !me.data) return <ErrorAlert error={doc.error ?? me.error} />;
  const d = doc.data;
  const status = d.approvalStatus;
  const isCreator = d.createdBy === me.data.id;
  const isApprover = status === 'WAITING_FOR_APPROVE' && d.assignedApproverId === me.data.id;
  const editable = ['DRAFT', 'REJECTED'].includes(status);
  const hasUsed = d.lines.some((l) => l.usedQuantity !== undefined);
  const lineColumns: GridColDef<DocLine>[] = [
    { field: 'ref', headerName: t(`${cfg.key}.lineRef`), flex: 1, minWidth: 150 },
    { field: 'partNumber', headerName: t('product.partNumber'), width: 150 },
    { field: 'productName', headerName: t('product.name'), flex: 1, minWidth: 160 },
    { field: 'quantity', headerName: t('gr.quantity'), type: 'number', width: 110, valueGetter: (v: string) => num(v) },
    ...(hasUsed ? [{ field: 'usedQuantity', headerName: t(`${cfg.key}.used`), type: 'number' as const, width: 130, valueGetter: (v: string) => num(v) }] : []),
    { field: 'uom', headerName: t('product.uom'), width: 70 },
  ];
  const actions = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button onClick={onBack}>{t('gr.back')}</Button>
      {isCreator && (editable || status === 'APPROVED') && <Button onClick={() => setAction('cancel')}>{t('doc.cancel')}</Button>}
      {isCreator && ['WAITING_FOR_APPROVE', 'APPROVED'].includes(status) && <Button onClick={() => setAction('recall')}>{t('doc.recall')}</Button>}
      {isCreator && editable && <Button variant="contained" onClick={() => setAction('submit')}>{t('doc.submit')}</Button>}
      {isApprover && <Button color="error" onClick={() => setAction('reject')}>{t('doc.reject')}</Button>}
      {isApprover && <Button variant="contained" onClick={() => setAction('approve')}>{t('doc.approve')}</Button>}
    </Stack>
  );
  return (
    <>
      <PageHeader title={`${t(`${cfg.key}.title`)} ${d.documentNumber}`} action={actions} />
      {status === 'WAITING_FOR_APPROVE' && !isApprover && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('doc.waitingFor', { name: d.assignedApproverName })}</Typography>
      )}
      <Paper>
        <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('gr.tabGeneral')} /><Tab label={t(`${cfg.key}.tabChildren`)} /><Tab label={t('gr.tabApprovers')} />
        </Tabs>
        <Stack sx={{ p: 2 }} spacing={1.5}>
          {tab === 0 && (
            <>
              <Field label={t('common.status')}><ApprovalStatusChip status={status} /></Field>
              {cfg.fields(d, t).map(([label, value]) => <Field key={label} label={label}>{value}</Field>)}
              <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
              <Field label={t('gr.approver')}>{d.assignedApproverName ?? '—'}</Field>
              <DataTable rows={d.lines} columns={lineColumns} hideFooter />
            </>
          )}
          {tab === 1 && (d.children.length
            ? d.children.map((c) => (
                <Stack key={c.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ minWidth: 170 }}>{c.documentNumber}</Typography><ApprovalStatusChip status={c.approvalStatus} />
                </Stack>
              ))
            : <Typography variant="body2" color="text.secondary">{t(`${cfg.key}.noChildren`)}</Typography>)}
          {tab === 2 && <HistoryList history={d.history} />}
        </Stack>
      </Paper>
      {action && (
        <DocActionDialog basePath={`/${cfg.path}/${id}`} action={action} approversPath={`/${cfg.path}/${id}/approvers`} approved={status === 'APPROVED'}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); void qc.invalidateQueries({ queryKey: [cfg.key] }); }} />
      )}
    </>
  );
}

// ---------- create forms ----------

interface ScOption { id: number; documentNumber: string; status: string; customerName: string }
interface ScLineOption { id: number; itemCode: string; itemName: string; uomName: string; quantity: string }

/** Quantity input bounded by what the source line still allows. */
function QtyField({ value, max, onChange, label }: { value: string; max: number; onChange: (v: string) => void; label: string }) {
  const { t } = useTranslation();
  const over = num(value) > max;
  return (
    <TextField label={label} type="number" value={value} onChange={(e) => onChange(e.target.value)} sx={{ maxWidth: { sm: 160 } }}
      error={over} helperText={over ? t('doc.overRemaining', { max }) : undefined} slotProps={{ htmlInput: { min: 0, max } }} />
  );
}

function CreatePrDialog({ onClose, onCreated }: CreateProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [scId, setScId] = useState('');
  const [lines, setLines] = useState<Record<number, { productId: string; quantity: string }>>({});
  const contracts = useQuery({ queryKey: ['scs'], queryFn: () => api<ScOption[]>('/sales-contracts') });
  const scLines = useQuery({ queryKey: ['sc-lines', scId], queryFn: () => api<ScLineOption[]>(`/sales-contracts/${scId}/lines`), enabled: Boolean(scId) });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products') });
  const chosen = Object.entries(lines).filter(([, l]) => l.productId && num(l.quantity) > 0);
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/purchase-requisitions', {
      method: 'POST',
      body: JSON.stringify({ salesContractId: Number(scId), lines: chosen.map(([lineId, l]) => ({ salesContractLineId: Number(lineId), productId: Number(l.productId), quantity: num(l.quantity) })) }),
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['pr'] }); onCreated(r.id); },
  });
  return (
    <FormDialog title={t('pr.create')} submitLabel={t('pr.create')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(scId && chosen.length)} onSubmit={() => create.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{t('pr.createHint')}</Typography>
      <TextField select label={t('gir.salesContract')} value={scId} onChange={(e) => { setScId(e.target.value); setLines({}); }} required
        helperText={contracts.data && !contracts.data.some((c) => c.status === 'ACTIVE') ? t('pr.noActiveContract') : undefined}>
        {(contracts.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => <MenuItem key={c.id} value={c.id}>{c.documentNumber}: {c.customerName}</MenuItem>)}
      </TextField>
      {(scLines.data ?? []).map((l) => {
        const v = lines[l.id] ?? { productId: '', quantity: '' };
        return (
          <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.itemCode}: {l.itemName} ({num(l.quantity)} {l.uomName})</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField select fullWidth label={t('pr.product')} value={v.productId} onChange={(e) => setLines({ ...lines, [l.id]: { ...v, productId: e.target.value } })}>
                <MenuItem value="">{t('pr.skipLine')}</MenuItem>
                {(products.data ?? []).filter((p) => p.isActive).map((p) => <MenuItem key={p.id} value={p.id}>{p.partNumber}: {p.name} ({p.unitOfMeasure.code})</MenuItem>)}
              </TextField>
              <TextField label={t('gr.quantity')} type="number" value={v.quantity} sx={{ maxWidth: { sm: 160 } }} slotProps={{ htmlInput: { min: 0 } }}
                onChange={(e) => setLines({ ...lines, [l.id]: { ...v, quantity: e.target.value } })} />
            </Stack>
          </Stack>
        );
      })}
    </FormDialog>
  );
}

interface SourceLine { id: number; partNumber: string; productName: string; uom: string; quantity: string; remaining: string; prNumber: string; salesContractNumber?: string }

/** Lines of a source document with a quantity per line, prefilled with the remaining quantity. */
function SourceLinesPicker({ lines, qty, setQty }: { lines: SourceLine[]; qty: Record<number, string>; setQty: (q: Record<number, string>) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {lines.map((l) => (
        <Stack key={l.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider', alignItems: { sm: 'center' } }}>
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.partNumber}: {l.productName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[l.prNumber, l.salesContractNumber].filter(Boolean).join(', ')}. {t('doc.remaining', { remaining: num(l.remaining), uom: l.uom })}
            </Typography>
          </Stack>
          <QtyField label={t('gr.quantity')} value={qty[l.id] ?? ''} max={num(l.remaining)} onChange={(v) => setQty({ ...qty, [l.id]: v })} />
        </Stack>
      ))}
    </>
  );
}

const pickedLines = (lines: SourceLine[] | undefined, qty: Record<number, string>) =>
  (lines ?? []).filter((l) => num(qty[l.id] ?? 0) > 0).map((l) => ({ sourceLineId: l.id, quantity: num(qty[l.id]) }));
const withinRemaining = (lines: SourceLine[] | undefined, qty: Record<number, string>) => (lines ?? []).every((l) => num(qty[l.id] ?? 0) <= num(l.remaining));

function CreatePoDialog({ onClose, onCreated }: CreateProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<{ id: number; code: string; name: string }[]>('/suppliers') });
  const lines = useQuery({ queryKey: ['pr-lines-for-po'], queryFn: () => api<SourceLine[]>('/purchase-requisition-lines/available-for-po') });
  const picked = pickedLines(lines.data, qty);
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/purchase-orders', { method: 'POST', body: JSON.stringify({ supplierId: Number(supplierId), lines: picked }) }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['po'] }); void qc.invalidateQueries({ queryKey: ['pr-lines-for-po'] }); onCreated(r.id); },
  });
  return (
    <FormDialog title={t('po.create')} submitLabel={t('po.create')} error={create.error ?? lines.error} pending={create.isPending}
      canSubmit={Boolean(supplierId && picked.length && withinRemaining(lines.data, qty))} onSubmit={() => create.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{t('po.createHint')}</Typography>
      <TextField select label={t('po.supplier')} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required
        helperText={suppliers.data?.length === 0 ? t('po.noSupplier') : undefined}>
        {(suppliers.data ?? []).map((s) => <MenuItem key={s.id} value={s.id}>{s.code}: {s.name}</MenuItem>)}
      </TextField>
      {lines.data?.length === 0 && <Typography variant="body2" color="text.secondary">{t('po.noLines')}</Typography>}
      <SourceLinesPicker lines={lines.data ?? []} qty={qty} setQty={setQty} />
    </FormDialog>
  );
}

function CreateGrrDialog({ onClose, onCreated }: CreateProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [poId, setPoId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const pos = useQuery({ queryKey: ['po', 'list', false], queryFn: () => api<DocRow[]>('/purchase-orders?assignedToMe=false') });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ id: number; code: string; name: string }[]>('/warehouses') });
  const lines = useQuery({ queryKey: ['po-lines-for-grr', poId], queryFn: () => api<SourceLine[]>(`/purchase-orders/${poId}/lines-available-for-grr`), enabled: Boolean(poId) });
  const picked = pickedLines(lines.data, qty);
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/goods-receipt-requests', {
      method: 'POST', body: JSON.stringify({ purchaseOrderId: Number(poId), warehouseId: Number(warehouseId), lines: picked }),
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['grr'] }); void qc.invalidateQueries({ queryKey: ['po-lines-for-grr'] }); onCreated(r.id); },
  });
  const approvedPos = (pos.data ?? []).filter((p) => p.approvalStatus === 'APPROVED');
  return (
    <FormDialog title={t('grr.create')} submitLabel={t('grr.create')} error={create.error ?? lines.error} pending={create.isPending}
      canSubmit={Boolean(poId && warehouseId && picked.length && withinRemaining(lines.data, qty))} onSubmit={() => create.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{t('grr.createHint')}</Typography>
      <TextField select label={t('gr.po')} value={poId} onChange={(e) => { setPoId(e.target.value); setQty({}); }} required
        helperText={pos.data && !approvedPos.length ? t('grr.noPo') : undefined}>
        {approvedPos.map((p) => <MenuItem key={p.id} value={p.id}>{p.documentNumber}: {String(p.supplierName)}</MenuItem>)}
      </TextField>
      <TextField select label={t('inventory.warehouse')} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
        {(warehouses.data ?? []).filter((w) => me.data?.warehouseIds.includes(w.id)).map((w) => <MenuItem key={w.id} value={w.id}>{w.code}: {w.name}</MenuItem>)}
      </TextField>
      {poId && lines.data?.length === 0 && <Typography variant="body2" color="text.secondary">{t('grr.noLines')}</Typography>}
      <SourceLinesPicker lines={lines.data ?? []} qty={qty} setQty={setQty} />
    </FormDialog>
  );
}

// ---------- pages ----------

const PR: DocConfig = {
  key: 'pr', perm: 'PR', path: 'purchase-requisitions', Create: CreatePrDialog,
  columns: (t) => [
    { field: 'salesContractNumber', headerName: t('gir.salesContract'), width: 160 },
    { field: 'customerName', headerName: t('sc.customer'), flex: 1, minWidth: 160 },
  ],
  fields: (d, t) => [[t('gir.salesContract'), `${String(d.salesContractNumber)}: ${String(d.customerName)}`]],
};
const PO: DocConfig = {
  key: 'po', perm: 'PO', path: 'purchase-orders', Create: CreatePoDialog,
  columns: (t) => [{ field: 'supplierName', headerName: t('po.supplier'), flex: 1, minWidth: 180 }],
  fields: (d, t) => [[t('po.supplier'), String(d.supplierName)]],
};
const GRR: DocConfig = {
  key: 'grr', perm: 'GRR', path: 'goods-receipt-requests', Create: CreateGrrDialog,
  columns: (t) => [
    { field: 'poNumber', headerName: t('gr.po'), width: 160 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 90 },
  ],
  fields: (d, t) => [[t('gr.po'), `${String(d.poNumber)}: ${String(d.supplierName)}`], [t('inventory.warehouse'), String(d.warehouseCode)]],
};

export const PurchaseRequisitionsPage = () => <DocListPage cfg={PR} />;
export const PurchaseOrdersPage = () => <DocListPage cfg={PO} />;
export const GoodsReceiptRequestsPage = () => <DocListPage cfg={GRR} />;
