import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from './api';
import { FormDialog } from './pages';
import { ApprovalStatusChip, DataTable, ErrorAlert, PageHeader } from './ui';

interface GrListRow {
  id: number; documentNumber: string; approvalStatus: string; grrNumber: string; warehouseCode: string;
  createdByName: string; assignedApproverName: string | null; createdAt: string;
}
interface GrLine { id: number; partNumber: string; productName: string; isSerialTracked: boolean; uom: string; quantity: string }
interface GrDetailRow { id: number; lineId: number; quantity: string; serialNumber: string | null }
interface GrDetail extends GrListRow {
  version: number; createdBy: number; assignedApproverId: number | null; poNumber: string;
  lines: GrLine[]; details: GrDetailRow[]; history: { action: string; reason: string | null; createdAt: string; actorName: string }[];
}
interface Me { id: number; permissions: string[] }
interface Person { id: number; fullName: string; username: string }

const fmtDate = (v: string) => new Date(v).toLocaleString();
const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });

export function GoodsReceiptsPage({ initialId }: { initialId?: number } = {}) {
  const { t } = useTranslation();
  const me = useMe();
  const [openId, setOpenId] = useState<number | null>(initialId ?? null);
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const list = useQuery({ queryKey: ['grs', mine], queryFn: () => api<GrListRow[]>(`/goods-receipts?assignedToMe=${mine}`) });

  if (openId) return <GoodsReceiptDetail id={openId} onBack={() => setOpenId(null)} />;

  const columns: GridColDef<GrListRow>[] = [
    { field: 'documentNumber', headerName: t('gr.number'), width: 170 },
    { field: 'approvalStatus', headerName: t('common.status'), width: 150, renderCell: (p) => <ApprovalStatusChip status={p.value} /> },
    { field: 'grrNumber', headerName: t('gr.grr'), width: 170 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 100 },
    { field: 'createdByName', headerName: t('gr.createdBy'), flex: 1, minWidth: 150 },
    { field: 'assignedApproverName', headerName: t('gr.approver'), flex: 1, minWidth: 150 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  return (
    <>
      <PageHeader title={t('nav.goodsReceipts')} action={me.data?.permissions.includes('GR.CREATE') && <Button variant="contained" onClick={() => setCreating(true)}>{t('gr.create')}</Button>} />
      <Stack spacing={2}>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label={t('gr.waitingForMe')} />
        <ErrorAlert error={list.error} />
        <DataTable
          rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t('gr.empty')}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Stack>
      {creating && <CreateGrDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}

function CreateGrDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [grrId, setGrrId] = useState('');
  const grrs = useQuery({
    queryKey: ['grrs-for-gr'],
    queryFn: () => api<{ id: number; documentNumber: string; warehouseCode: string; poNumber: string }[]>('/goods-receipt-requests/available-for-gr'),
  });
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/goods-receipts', { method: 'POST', body: JSON.stringify({ goodsReceiptRequestId: Number(grrId) }) }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['grs'] }); onCreated(r.id); },
  });
  return (
    <FormDialog title={t('gr.create')} submitLabel={t('gr.create')} error={create.error ?? grrs.error} pending={create.isPending}
      canSubmit={Boolean(grrId)} onSubmit={() => create.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{t('gr.createHint')}</Typography>
      <TextField select label={t('gr.grr')} value={grrId} onChange={(e) => setGrrId(e.target.value)} required
        helperText={grrs.data?.length === 0 ? t('gr.noGrr') : undefined}>
        {(grrs.data ?? []).map((g) => <MenuItem key={g.id} value={g.id}>{g.documentNumber} — {g.poNumber} — {g.warehouseCode}</MenuItem>)}
      </TextField>
    </FormDialog>
  );
}

type Action = 'submit' | 'approve' | 'reject' | 'recall' | 'cancel' | null;

function GoodsReceiptDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [tab, setTab] = useState(0);
  const [action, setAction] = useState<Action>(null);
  const [serials, setSerials] = useState<Record<number, string>>({});
  const gr = useQuery({ queryKey: ['gr', id], queryFn: () => api<GrDetail>(`/goods-receipts/${id}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['gr', id] }); void qc.invalidateQueries({ queryKey: ['grs'] }); };

  const save = useMutation({
    mutationFn: () => api(`/goods-receipts/${id}/details`, {
      method: 'PATCH',
      body: JSON.stringify({ version: gr.data!.version, details: Object.entries(serials).map(([d, sn]) => ({ id: Number(d), serialNumber: sn })) }),
    }),
    onSuccess: () => { setSerials({}); refresh(); },
  });

  if (!gr.data || !me.data) return <ErrorAlert error={gr.error ?? me.error} />;
  const d = gr.data;
  const editable = ['DRAFT', 'REJECTED'].includes(d.approvalStatus)
    && (d.createdBy === me.data.id || me.data.permissions.includes('GR.DECLARE_DETAILS'));
  const isCreator = d.createdBy === me.data.id;
  const isApprover = d.approvalStatus === 'WAITING_FOR_APPROVE' && d.assignedApproverId === me.data.id;
  const dirty = Object.keys(serials).length > 0;

  const actions = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button onClick={onBack}>{t('gr.back')}</Button>
      {editable && <Button variant="outlined" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{t('gr.saveDetails')}</Button>}
      {isCreator && ['DRAFT', 'REJECTED'].includes(d.approvalStatus) && (
        <>
          <Button onClick={() => setAction('cancel')}>{t('gr.cancel')}</Button>
          <Button variant="contained" disabled={dirty} onClick={() => setAction('submit')}>{t('gr.submit')}</Button>
        </>
      )}
      {/* APPROVED: recall undoes the stock effect; the server refuses while the stock or the receipt is in use (03 §2.2). */}
      {isCreator && ['WAITING_FOR_APPROVE', 'APPROVED'].includes(d.approvalStatus) && <Button onClick={() => setAction('recall')}>{t('gr.recall')}</Button>}
      {isApprover && (
        <>
          <Button color="error" onClick={() => setAction('reject')}>{t('gr.reject')}</Button>
          <Button variant="contained" onClick={() => setAction('approve')}>{t('gr.approve')}</Button>
        </>
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={`${t('gr.title')} ${d.documentNumber}`} action={actions} />
      <Stack spacing={2}>
        <ErrorAlert error={save.error} />
        <Paper>
          <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label={t('gr.tabGeneral')} />
            <Tab label={t('gr.tabDetails')} />
            <Tab label={t('gr.tabApprovers')} />
          </Tabs>
          <Stack sx={{ p: 2 }} spacing={1.5}>
            {tab === 0 && <General d={d} />}
            {tab === 1 && <DetailsTab d={d} editable={editable} serials={serials} setSerials={setSerials} />}
            {tab === 2 && <History d={d} />}
          </Stack>
        </Paper>
      </Stack>
      {action && <ActionDialog grId={id} action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); refresh(); }} />}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: { sm: 180 }, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" component="div">{children}</Typography>
    </Stack>
  );
}

function General({ d }: { d: GrDetail }) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t('common.status')}><ApprovalStatusChip status={d.approvalStatus} /></Field>
      <Field label={t('gr.grr')}>{d.grrNumber}</Field>
      <Field label={t('gr.po')}>{d.poNumber}</Field>
      <Field label={t('inventory.warehouse')}>{d.warehouseCode}</Field>
      <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
      <Field label={t('gr.approver')}>{d.assignedApproverName ?? '—'}</Field>
    </>
  );
}

function DetailsTab({ d, editable, serials, setSerials }: {
  d: GrDetail; editable: boolean; serials: Record<number, string>; setSerials: (s: Record<number, string>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {d.lines.map((l) => {
        const details = d.details.filter((x) => x.lineId === l.id);
        const declared = details.filter((x) => (serials[x.id] ?? x.serialNumber ?? '').trim()).length;
        return (
          <Stack key={l.id} spacing={1} sx={{ pb: 2, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
            <Typography variant="h2" component="h3">{l.partNumber} — {l.productName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('gr.quantity')}: {Number(l.quantity)} {l.uom}
              {l.isSerialTracked ? `, ${t('gr.serialsDeclared', { declared, total: details.length })}` : `, ${t('gr.noSerial')}`}
            </Typography>
            {l.isSerialTracked && (
              <Stack spacing={1} sx={{ maxWidth: 420 }}>
                {details.map((x, i) => (
                  <TextField key={x.id} label={`SN #${i + 1}`} value={serials[x.id] ?? x.serialNumber ?? ''} disabled={!editable}
                    onChange={(e) => setSerials({ ...serials, [x.id]: e.target.value })} />
                ))}
              </Stack>
            )}
          </Stack>
        );
      })}
    </>
  );
}

function History({ d }: { d: GrDetail }) {
  const { t } = useTranslation();
  if (!d.history.length) return <Typography variant="body2" color="text.secondary">{t('gr.noHistory')}</Typography>;
  return (
    <>
      {d.history.map((h, i) => (
        <Field key={i} label={fmtDate(h.createdAt)}>
          {t(`gr.action.${h.action}`)} — {h.actorName}{h.reason ? `: ${h.reason}` : ''}
        </Field>
      ))}
    </>
  );
}

function ActionDialog({ grId, action, onClose, onDone }: { grId: number; action: Exclude<Action, null>; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const approvers = useQuery({
    queryKey: ['gr-approvers', grId],
    queryFn: () => api<Person[]>(`/goods-receipts/${grId}/approvers`),
    enabled: action === 'submit',
  });
  // P4: preselect when exactly one eligible approver exists, otherwise the creator picks.
  const chosen = approverId || (approvers.data?.length === 1 ? String(approvers.data[0].id) : '');
  const needsReason = action === 'reject' || action === 'recall';
  const run = useMutation({
    mutationFn: () => api(`/goods-receipts/${grId}/${action}`, {
      method: 'POST',
      body: JSON.stringify(action === 'submit' ? { approverId: Number(chosen) } : needsReason ? { reason } : {}),
    }),
    onSuccess: onDone,
  });
  return (
    <FormDialog title={t(`gr.confirm.${action}`)} submitLabel={t(`gr.${action}`)} error={run.error ?? approvers.error} pending={run.isPending}
      canSubmit={action === 'submit' ? Boolean(chosen) : needsReason ? Boolean(reason.trim()) : true}
      onSubmit={() => run.mutate()} onClose={onClose}>
      {action === 'submit' && (
        <TextField select label={t('gr.approver')} value={chosen} onChange={(e) => setApproverId(e.target.value)} required
          helperText={approvers.data?.length === 0 ? t('gr.noApprover') : undefined}>
          {(approvers.data ?? []).map((u) => <MenuItem key={u.id} value={u.id}>{u.fullName} ({u.username})</MenuItem>)}
        </TextField>
      )}
      {needsReason && <TextField label={t('gr.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required multiline minRows={2} autoFocus />}
      {action === 'approve' && <Typography variant="body2">{t('gr.approveHint')}</Typography>}
      {action === 'cancel' && <Typography variant="body2">{t('gr.cancelHint')}</Typography>}
    </FormDialog>
  );
}
