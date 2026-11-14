import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Autocomplete, Button, Checkbox, FormControlLabel, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from './api';
import { DocAction, DocActionDialog, ExecutionChip, Field, fmtDate, HistoryEntry, HistoryList, Person, useMe } from './doc-ui';
import { FormDialog } from './pages';
import { ApprovalStatusChip, DataTable, ErrorAlert, PageHeader, StatusChip } from './ui';

// ---------- types ----------

interface GirRow {
  id: number; documentNumber: string; issueType: string; approvalStatus: string; approvalStep: number | null; executionStatus: string;
  salesContractNumber: string; warehouseCode: string; createdByName: string; assignedApproverName: string | null; createdAt: string;
}
interface PrLineOption {
  id: number; purchaseRequisitionId: number; prNumber: string; category: string; partNumber: string; productName: string; uom: string;
  quantity: string; receivedQuantity: string; remainingQuantity: number;
}
interface GirLine {
  id: number; prNumber: string | null; salesContractLineId: number | null; contractItem: string; contractQuantity: string; productId: number; partNumber: string;
  productName: string; isSerialTracked: boolean; uom: string; quantity: string; productConfirmed: boolean; issuedQuantity: string; committedQuantity: string;
}
interface GirDetail extends GirRow {
  category: string; version: number; warehouseId: number; salesContractId: number; createdBy: number; assignedApproverId: number | null;
  warehouseApproverName: string | null; completionReason: string | null;
  lines: GirLine[]; goodsIssues: { id: number; documentNumber: string; approvalStatus: string }[]; history: HistoryEntry[];
}
interface GiRow { id: number; documentNumber: string; approvalStatus: string; girNumber: string; warehouseCode: string; createdByName: string; assignedApproverName: string | null; createdAt: string }
interface GiDetail extends GiRow {
  version: number; goodsIssueRequestId: number; girExecutionStatus: string; createdBy: number; assignedApproverId: number | null;
  lines: { id: number; goodsIssueRequestLineId: number; partNumber: string; productName: string; isSerialTracked: boolean; uom: string; quantity: string; serials: { goodsReceiptDetailId: number; serialNumber: string }[] }[];
  history: HistoryEntry[];
}
interface ScLine { id: number; itemName: string; quantity: string; products: { productId: number; partNumber: string; name: string; status: string }[] }

const num = (v: string | number) => Number(v);

function StepChip({ d }: { d: { approvalStatus: string; approvalStep: number | null } }) {
  const { t } = useTranslation();
  return d.approvalStatus === 'WAITING_FOR_APPROVE' && d.approvalStep
    ? <StatusChip label={t(`gir.step${d.approvalStep}`)} tone="pending" />
    : <ApprovalStatusChip status={d.approvalStatus} />;
}

// ---------- GIR ----------

export function GoodsIssueRequestsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const list = useQuery({ queryKey: ['girs', mine], queryFn: () => api<GirRow[]>(`/goods-issue-requests?assignedToMe=${mine}`) });
  if (openId) return <GirDetailView id={openId} onBack={() => setOpenId(null)} />;
  const columns: GridColDef<GirRow>[] = [
    { field: 'documentNumber', headerName: t('gir.number'), width: 170 },
    { field: 'issueType', headerName: t('gir.type'), width: 160, valueFormatter: (v: string) => t(`gir.types.${v}`) },
    { field: 'approvalStatus', headerName: t('common.status'), width: 190, renderCell: (p) => <StepChip d={p.row} /> },
    { field: 'executionStatus', headerName: t('gir.execution'), width: 140, renderCell: (p) => <ExecutionChip status={p.value} /> },
    { field: 'salesContractNumber', headerName: t('gir.salesContract'), width: 160 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 90 },
    { field: 'assignedApproverName', headerName: t('gr.approver'), flex: 1, minWidth: 140 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  return (
    <>
      <PageHeader title={t('nav.goodsIssueRequests')} action={me.data?.permissions.includes('GIR.CREATE') && <Button variant="contained" onClick={() => setCreating(true)}>{t('gir.create')}</Button>} />
      <Stack spacing={2}>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label={t('gr.waitingForMe')} />
        <ErrorAlert error={list.error} />
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t('gir.empty')}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Stack>
      {creating && <CreateGirDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}

function CreateGirDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const [issueType, setIssueType] = useState('PURCHASE_REQUISITION');
  const [category, setCategory] = useState('SALES_GOODS');
  const [prQty, setPrQty] = useState<Record<number, string>>({});
  const [scId, setScId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Record<number, { productId: string; quantity: string }>>({});
  const contracts = useQuery({ queryKey: ['scs'], queryFn: () => api<{ id: number; documentNumber: string; status: string; customerName: string }[]>('/sales-contracts') });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ id: number; code: string; name: string; allowAvailableStockIssue: boolean }[]>('/warehouses') });
  const scLines = useQuery({ queryKey: ['sc-lines', scId], queryFn: () => api<ScLine[]>(`/sales-contracts/${scId}/lines`), enabled: Boolean(scId) });
  const isPr = issueType === 'PURCHASE_REQUISITION';
  const prLines = useQuery({ queryKey: ['gir-pr-lines', scId], queryFn: () => api<PrLineOption[]>(`/sales-contracts/${scId}/gir-pr-lines`), enabled: Boolean(scId && isPr) });
  const prChosen = (prLines.data ?? []).filter((l) => l.category === category && num(prQty[l.id] ?? '') > 0);
  const quota = useQuery({ queryKey: ['quota', scId], queryFn: () => api<{ salesContractLineId: number; contractQuantity: string; usedQuantity: string }[]>(`/sales-contracts/${scId}/gir-quota`), enabled: Boolean(scId) });
  const qc = useQueryClient();
  const chosen = Object.entries(lines).filter(([, l]) => l.productId && num(l.quantity) > 0);
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/goods-issue-requests', {
      method: 'POST',
      body: JSON.stringify({
        issueType, salesContractId: Number(scId), warehouseId: Number(warehouseId),
        lines: isPr
          ? prChosen.map((l) => ({ purchaseRequisitionLineId: l.id, quantity: num(prQty[l.id]) }))
          : chosen.map(([lineId, l]) => ({ salesContractLineId: Number(lineId), productId: Number(l.productId), quantity: num(l.quantity) })),
      }),
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['girs'] }); onCreated(r.id); },
  });
  const allowedWarehouses = (warehouses.data ?? []).filter((w) => me.data?.warehouseIds.includes(w.id) && (issueType !== 'AVAILABLE_STOCK' || w.allowAvailableStockIssue));
  return (
    <FormDialog title={t('gir.create')} submitLabel={t('gir.create')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(scId && warehouseId && (isPr ? prChosen.length : chosen.length))} onSubmit={() => create.mutate()} onClose={onClose}>
      <TextField select label={t('gir.type')} value={issueType} onChange={(e) => { setIssueType(e.target.value); setWarehouseId(''); }}>
        {['PURCHASE_REQUISITION', 'AVAILABLE_STOCK'].map((v) => <MenuItem key={v} value={v}>{t(`gir.types.${v}`)}</MenuItem>)}
      </TextField>
      {isPr && (
        <TextField select label={t('pr.category')} value={category} onChange={(e) => { setCategory(e.target.value); setPrQty({}); }} helperText={t('gir.categoryHint')}>
          {['SALES_GOODS', 'MATERIAL'].map((c) => <MenuItem key={c} value={c}>{t(`category.${c}`)}</MenuItem>)}
        </TextField>
      )}
      <TextField select label={t('gir.salesContract')} value={scId} onChange={(e) => { setScId(e.target.value); setLines({}); }} required>
        {(contracts.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => <MenuItem key={c.id} value={c.id}>{c.documentNumber}: {c.customerName}</MenuItem>)}
      </TextField>
      <TextField select label={t('inventory.warehouse')} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
        helperText={issueType === 'AVAILABLE_STOCK' ? t('gir.availableStockWarehouseHint') : undefined}>
        {allowedWarehouses.map((w) => <MenuItem key={w.id} value={w.id}>{w.code}: {w.name}</MenuItem>)}
      </TextField>
      {isPr && scId && prLines.data && !prLines.data.some((l) => l.category === category) && (
        <Typography variant="body2" color="text.secondary">{t('gir.noPoDonePr')}</Typography>
      )}
      {isPr && (prLines.data ?? []).filter((l) => l.category === category).map((l) => (
        <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.prNumber} · {l.partNumber}: {l.productName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('gir.prLineHint', { quantity: num(l.quantity), remaining: l.remainingQuantity, received: num(l.receivedQuantity), uom: l.uom })}
          </Typography>
          <TextField label={t('gr.quantity')} type="number" value={prQty[l.id] ?? ''} sx={{ maxWidth: { sm: 160 } }}
            slotProps={{ htmlInput: { min: 0, max: l.remainingQuantity } }} onChange={(e) => setPrQty({ ...prQty, [l.id]: e.target.value })} />
        </Stack>
      ))}
      {!isPr && (scLines.data ?? []).map((l) => {
        const q = quota.data?.find((x) => x.salesContractLineId === l.id);
        const remaining = q ? num(q.contractQuantity) - num(q.usedQuantity) : num(l.quantity);
        const v = lines[l.id] ?? { productId: '', quantity: '' };
        return (
          <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.itemName}</Typography>
            <Typography variant="body2" color="text.secondary">{t('gir.quotaHint', { contract: num(l.quantity), remaining })}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField select fullWidth label={t('gir.product')} value={v.productId}
                helperText={l.products.some((p) => p.status === 'APPROVED') ? undefined : t('gir.noConfirmedProduct')} onChange={(e) => setLines({ ...lines, [l.id]: { ...v, productId: e.target.value } })}>
                {/* Only products Sales confirmed for this line (03 §9.2) */}
                {l.products.filter((p) => p.status === 'APPROVED').map((p) => <MenuItem key={p.productId} value={p.productId}>{p.partNumber}: {p.name}</MenuItem>)}
              </TextField>
              <TextField label={t('gr.quantity')} type="number" value={v.quantity} sx={{ maxWidth: { sm: 160 } }}
                slotProps={{ htmlInput: { min: 0, max: remaining } }}
                onChange={(e) => setLines({ ...lines, [l.id]: { ...v, quantity: e.target.value } })} />
            </Stack>
          </Stack>
        );
      })}
    </FormDialog>
  );
}

function GirDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [tab, setTab] = useState(0);
  const [action, setAction] = useState<DocAction | null>(null);
  const [creatingGi, setCreatingGi] = useState(false);
  const [openGi, setOpenGi] = useState<number | null>(null);
  const gir = useQuery({ queryKey: ['gir', id], queryFn: () => api<GirDetail>(`/goods-issue-requests/${id}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['gir', id] }); void qc.invalidateQueries({ queryKey: ['girs'] }); };
  if (openGi) return <GiDetailView id={openGi} onBack={() => { setOpenGi(null); refresh(); }} />;
  if (!gir.data || !me.data) return <ErrorAlert error={gir.error ?? me.error} />;
  const d = gir.data;
  const isCreator = d.createdBy === me.data.id;
  const isApprover = d.approvalStatus === 'WAITING_FOR_APPROVE' && d.assignedApproverId === me.data.id;
  const open = d.approvalStatus === 'APPROVED' && d.executionStatus !== 'COMPLETED';
  const actions = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button onClick={onBack}>{t('gr.back')}</Button>
      {isCreator && ['DRAFT', 'REJECTED'].includes(d.approvalStatus) && <Button onClick={() => setAction('cancel')}>{t('doc.cancel')}</Button>}
      {isCreator && ['WAITING_FOR_APPROVE', 'APPROVED'].includes(d.approvalStatus) && d.executionStatus === 'NOT_STARTED' && <Button onClick={() => setAction('recall')}>{t('doc.recall')}</Button>}
      {isCreator && ['DRAFT', 'REJECTED'].includes(d.approvalStatus) && <Button variant="contained" onClick={() => setAction('submit')}>{t('doc.submit')}</Button>}
      {isApprover && <Button color="error" onClick={() => setAction('reject')}>{t('doc.reject')}</Button>}
      {isApprover && <Button variant="contained" onClick={() => setAction('approve')}>{t(d.approvalStep === 1 ? 'gir.confirm' : 'doc.approve')}</Button>}
      {open && me.data.permissions.includes('GIR.COMPLETE') && <Button onClick={() => setAction('complete')}>{t('doc.complete')}</Button>}
      {open && me.data.permissions.includes('GI.CREATE') && <Button variant="contained" onClick={() => setCreatingGi(true)}>{t('gi.create')}</Button>}
    </Stack>
  );
  const lineColumns: GridColDef<GirLine>[] = [
    ...(d.issueType === 'PURCHASE_REQUISITION' ? [{ field: 'prNumber', headerName: t('gir.prLine'), width: 150 }] : []),
    { field: 'contractItem', headerName: t('gir.contractItem'), flex: 1, minWidth: 160, valueFormatter: (v: string | null) => v ?? '—' },
    { field: 'partNumber', headerName: t('product.partNumber'), width: 150 },
    ...(d.category === 'SALES_GOODS' ? [{ field: 'productConfirmed', headerName: t('gir.confirmedBySales'), width: 150,
      renderCell: (p: { value?: boolean }) => <StatusChip label={t(p.value ? 'common.yes' : 'common.no')} tone={p.value ? 'success' : 'danger'} /> }] : []),
    { field: 'quantity', headerName: t('gir.requested'), type: 'number', width: 110, valueGetter: (v: string) => num(v) },
    { field: 'committedQuantity', headerName: t('gir.committed'), type: 'number', width: 130, valueGetter: (v: string) => num(v) },
    { field: 'issuedQuantity', headerName: t('gir.issued'), type: 'number', width: 110, valueGetter: (v: string) => num(v) },
    { field: 'uom', headerName: t('product.uom'), width: 70 },
  ];
  return (
    <>
      <PageHeader title={`${t('gir.title')} ${d.documentNumber}`} action={actions} />
      <Paper>
        <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('gr.tabGeneral')} /><Tab label={t('gi.tabIssues')} /><Tab label={t('gr.tabApprovers')} />
        </Tabs>
        <Stack sx={{ p: 2 }} spacing={1.5}>
          {tab === 0 && (
            <>
              <Field label={t('common.status')}><StepChip d={d} /></Field>
              <Field label={t('gir.execution')}><ExecutionChip status={d.executionStatus} /></Field>
              <Field label={t('gir.type')}>{t(`gir.types.${d.issueType}`)}</Field>
              <Field label={t('pr.category')}>{t(`category.${d.category}`)}</Field>
              <Field label={t('gir.salesContract')}>{d.salesContractNumber}</Field>
              <Field label={t('inventory.warehouse')}>{d.warehouseCode}</Field>
              <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
              <Field label={t('gr.approver')}>{d.assignedApproverName ?? '—'}</Field>
              {d.issueType === 'AVAILABLE_STOCK' && <Field label={t('gir.warehouseApprover')}>{d.warehouseApproverName ?? '—'}</Field>}
              {d.completionReason && <Field label={t('gir.completionReason')}>{d.completionReason}</Field>}
              <DataTable rows={d.lines} columns={lineColumns} hideFooter />
            </>
          )}
          {tab === 1 && (d.goodsIssues.length
            ? d.goodsIssues.map((g) => (
                <Stack key={g.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Button onClick={() => setOpenGi(g.id)}>{g.documentNumber}</Button><ApprovalStatusChip status={g.approvalStatus} />
                </Stack>
              ))
            : <Typography variant="body2" color="text.secondary">{t('gi.none')}</Typography>)}
          {tab === 2 && <HistoryList history={d.history} />}
        </Stack>
      </Paper>
      {action === 'submit' && d.issueType === 'AVAILABLE_STOCK'
        ? <SubmitTwoStepDialog girId={id} onClose={() => setAction(null)} onDone={() => { setAction(null); refresh(); }} />
        : action && <DocActionDialog basePath={`/goods-issue-requests/${id}`} action={action} approversPath={`/goods-issue-requests/${id}/approvers`}
            onClose={() => setAction(null)} onDone={() => { setAction(null); refresh(); }} />}
      {creatingGi && <CreateGiDialog gir={d} onClose={() => setCreatingGi(false)} onCreated={(giId) => { setCreatingGi(false); setOpenGi(giId); }} />}
    </>
  );
}

/** AVAILABLE_STOCK: pick the Sales confirmer (step 1) and the warehouse manager (step 2). */
function SubmitTwoStepDialog({ girId, onClose, onDone }: { girId: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [sales, setSales] = useState('');
  const [manager, setManager] = useState('');
  const people = useQuery({ queryKey: ['gir-approvers', girId], queryFn: () => api<{ approvers: Person[]; warehouseApprovers: Person[] }>(`/goods-issue-requests/${girId}/approvers`) });
  const pick = (v: string, list?: Person[]) => v || (list?.length === 1 ? String(list[0].id) : '');
  const s = pick(sales, people.data?.approvers);
  const m = pick(manager, people.data?.warehouseApprovers);
  const run = useMutation({
    mutationFn: () => api(`/goods-issue-requests/${girId}/submit`, { method: 'POST', body: JSON.stringify({ approverId: Number(s), warehouseApproverId: Number(m) }) }),
    onSuccess: onDone,
  });
  const options = (list?: Person[]) => (list ?? []).map((u) => <MenuItem key={u.id} value={u.id}>{u.fullName} ({u.username})</MenuItem>);
  return (
    <FormDialog title={t('doc.confirm.submit')} submitLabel={t('doc.submit')} error={run.error ?? people.error} pending={run.isPending}
      canSubmit={Boolean(s && m)} onSubmit={() => run.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{t('gir.twoStepHint')}</Typography>
      <TextField select label={t('gir.salesApprover')} value={s} onChange={(e) => setSales(e.target.value)} required>{options(people.data?.approvers)}</TextField>
      <TextField select label={t('gir.warehouseApprover')} value={m} onChange={(e) => setManager(e.target.value)} required>{options(people.data?.warehouseApprovers)}</TextField>
    </FormDialog>
  );
}

// ---------- GI ----------

function CreateGiDialog({ gir, onClose, onCreated }: { gir: GirDetail; onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [serials, setSerials] = useState<Record<number, { goodsReceiptDetailId: number; serialNumber: string }[]>>({});
  const lines = gir.lines.map((l) => ({ ...l, remaining: num(l.quantity) - num(l.committedQuantity) }));
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/goods-issues', {
      method: 'POST',
      body: JSON.stringify({
        goodsIssueRequestId: gir.id,
        lines: lines.filter((l) => num(qty[l.id] ?? 0) > 0).map((l) => ({
          goodsIssueRequestLineId: l.id, quantity: num(qty[l.id]), goodsReceiptDetailIds: (serials[l.id] ?? []).map((s) => s.goodsReceiptDetailId),
        })),
      }),
    }),
    onSuccess: (r) => onCreated(r.id),
  });
  return (
    <FormDialog title={t('gi.create')} submitLabel={t('gi.create')} error={create.error} pending={create.isPending}
      canSubmit={lines.some((l) => num(qty[l.id] ?? 0) > 0)} onSubmit={() => create.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{t('gi.createHint')}</Typography>
      {lines.map((l) => (
        <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.partNumber}: {l.productName}</Typography>
          <Typography variant="body2" color="text.secondary">{t('gi.remaining', { remaining: l.remaining, uom: l.uom })}</Typography>
          <TextField label={t('gi.issueQuantity')} type="number" value={qty[l.id] ?? ''} sx={{ maxWidth: 200 }} disabled={l.remaining <= 0}
            slotProps={{ htmlInput: { min: 0, max: l.remaining, step: 1 } }} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
          {l.isSerialTracked && num(qty[l.id] ?? 0) > 0 && (
            <SerialPicker girLineId={l.id} max={num(qty[l.id])} value={serials[l.id] ?? []} onChange={(v) => setSerials({ ...serials, [l.id]: v })} />
          )}
        </Stack>
      ))}
    </FormDialog>
  );
}

function SerialPicker({ girLineId, max, value, onChange }: {
  girLineId: number; max: number; value: { goodsReceiptDetailId: number; serialNumber: string }[]; onChange: (v: typeof value) => void;
}) {
  const { t } = useTranslation();
  const options = useQuery({
    queryKey: ['serials', girLineId],
    queryFn: () => api<{ goodsReceiptDetailId: number; serialNumber: string }[]>(`/goods-issue-request-lines/${girLineId}/available-serials`),
  });
  return (
    <Autocomplete multiple size="small" options={options.data ?? []} value={value} loading={options.isLoading}
      getOptionLabel={(o) => o.serialNumber} isOptionEqualToValue={(a, b) => a.goodsReceiptDetailId === b.goodsReceiptDetailId}
      getOptionDisabled={(o) => value.length >= max && !value.some((v) => v.goodsReceiptDetailId === o.goodsReceiptDetailId)}
      onChange={(_e, v) => onChange(v)}
      renderInput={(params) => <TextField {...params} label={t('gi.serials', { selected: value.length, max })} />} />
  );
}

export function GoodsIssuesPage() {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const list = useQuery({ queryKey: ['gis', mine], queryFn: () => api<GiRow[]>(`/goods-issues?assignedToMe=${mine}`) });
  if (openId) return <GiDetailView id={openId} onBack={() => setOpenId(null)} />;
  const columns: GridColDef<GiRow>[] = [
    { field: 'documentNumber', headerName: t('gi.number'), width: 170 },
    { field: 'approvalStatus', headerName: t('common.status'), width: 150, renderCell: (p) => <ApprovalStatusChip status={p.value} /> },
    { field: 'girNumber', headerName: t('gi.gir'), width: 170 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 90 },
    { field: 'createdByName', headerName: t('gr.createdBy'), flex: 1, minWidth: 140 },
    { field: 'assignedApproverName', headerName: t('gr.approver'), flex: 1, minWidth: 140 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  return (
    <>
      <PageHeader title={t('nav.goodsIssues')} />
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">{t('gi.listHint')}</Typography>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label={t('gr.waitingForMe')} />
        <ErrorAlert error={list.error} />
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t('gi.empty')}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Stack>
    </>
  );
}

function GiDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [tab, setTab] = useState(0);
  const [action, setAction] = useState<DocAction | null>(null);
  const gi = useQuery({ queryKey: ['gi', id], queryFn: () => api<GiDetail>(`/goods-issues/${id}`) });
  if (!gi.data || !me.data) return <ErrorAlert error={gi.error ?? me.error} />;
  const d = gi.data;
  const isCreator = d.createdBy === me.data.id;
  const isApprover = d.approvalStatus === 'WAITING_FOR_APPROVE' && d.assignedApproverId === me.data.id;
  const done = () => { setAction(null); void qc.invalidateQueries({ queryKey: ['gi', id] }); void qc.invalidateQueries({ queryKey: ['gis'] }); };
  const canComplete = me.data.permissions.includes('GIR.COMPLETE') && d.girExecutionStatus !== 'COMPLETED';
  const actions = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button onClick={onBack}>{t('gr.back')}</Button>
      {isCreator && ['DRAFT', 'REJECTED'].includes(d.approvalStatus) && <Button onClick={() => setAction('cancel')}>{t('doc.cancel')}</Button>}
      {isCreator && d.approvalStatus === 'WAITING_FOR_APPROVE' && <Button onClick={() => setAction('recall')}>{t('doc.recall')}</Button>}
      {isCreator && ['DRAFT', 'REJECTED'].includes(d.approvalStatus) && <Button variant="contained" onClick={() => setAction('submit')}>{t('doc.submit')}</Button>}
      {isApprover && <Button color="error" onClick={() => setAction('reject')}>{t('doc.reject')}</Button>}
      {isApprover && <Button variant="contained" onClick={() => setAction('approve')}>{t('doc.approve')}</Button>}
      {canComplete && <Button onClick={() => setAction('complete')}>{t('gi.completeGir')}</Button>}
    </Stack>
  );
  return (
    <>
      <PageHeader title={`${t('gi.title')} ${d.documentNumber}`} action={actions} />
      <Paper>
        <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('gr.tabGeneral')} /><Tab label={t('gr.tabApprovers')} />
        </Tabs>
        <Stack sx={{ p: 2 }} spacing={1.5}>
          {tab === 0 && (
            <>
              <Field label={t('common.status')}><ApprovalStatusChip status={d.approvalStatus} /></Field>
              <Field label={t('gi.gir')}>{d.girNumber} <ExecutionChip status={d.girExecutionStatus} /></Field>
              <Field label={t('inventory.warehouse')}>{d.warehouseCode}</Field>
              <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
              <Field label={t('gr.approver')}>{d.assignedApproverName ?? '—'}</Field>
              {d.lines.map((l) => (
                <Stack key={l.id} spacing={0.5} sx={{ pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="h2" component="h3">{l.partNumber}: {l.productName}</Typography>
                  <Typography variant="body2" color="text.secondary">{t('gr.quantity')}: {num(l.quantity)} {l.uom}</Typography>
                  {l.isSerialTracked && <Typography variant="body2">SN: {l.serials.map((s) => s.serialNumber).join(', ') || '—'}</Typography>}
                </Stack>
              ))}
            </>
          )}
          {tab === 1 && <HistoryList history={d.history} />}
        </Stack>
      </Paper>
      {action && (
        <DocActionDialog basePath={action === 'complete' ? `/goods-issue-requests/${d.goodsIssueRequestId}` : `/goods-issues/${id}`}
          action={action} approversPath={`/goods-issues/${id}/approvers`} onClose={() => setAction(null)} onDone={done} />
      )}
    </>
  );
}
