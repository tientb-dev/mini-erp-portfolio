import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ApprovalStatusChip, DataTable, ErrorAlert, Field, FormDialog, PageHeader, StatusChip } from '../../shared/components';
import { fmtDate, num } from '../../shared/utils/format';
import { useMe } from '../identity';
import { DocAction, DocActionDialog, HistoryList, Person } from '../workflow';
import { ExecutionChip } from './ExecutionChip';
import { StepChip } from './StepChip';
import { CreateGiDialog } from './CreateGiDialog';
import { GiDetailView } from './GiDetailView';
import { GirDetail, GirLine } from './types';

export function GirDetailView({ id, onBack }: { id: number; onBack: () => void }) {
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
    ...(d.issueType === 'PURCHASE_REQUISITION' ? [
      { field: 'firstGoodsReceipt', headerName: t('gir.firstReceipt'), width: 190, sortable: false,
        valueGetter: (v: GirLine['firstGoodsReceipt']) => (v ? `${v.documentNumber} · ${v.warehouseCode}` : t('gir.notReceived')) },
      { field: 'receivedQuantity', headerName: t('gir.received'), type: 'number' as const, width: 120 },
    ] : []),
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
              {d.issueType === 'AVAILABLE_STOCK' && <Field label={t('gir.source')}>{d.sourceSalesContractNumber ?? '—'} · {d.sourceOwnerName ?? '—'}</Field>}
              {d.purpose && <Field label={t('gir.purpose')}>{d.purpose}</Field>}
              {d.issueType === 'AVAILABLE_STOCK' && <Field label={t('gir.warehouseApprover')}>{d.warehouseApproverName ?? '—'}</Field>}
              {d.completionReason && <Field label={t('gir.completionReason')}>{d.completionReason}</Field>}
              {d.issueType === 'PURCHASE_REQUISITION' && <Typography variant="body2" color="text.secondary">{t('gir.referenceHint')}</Typography>}
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
            sourceConfirm={action === 'approve' && d.issueType === 'AVAILABLE_STOCK' && d.approvalStep === 1}
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
