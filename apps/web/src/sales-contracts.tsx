import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api, Product } from './api';
import { Field, fmtDate, useMe } from './doc-ui';
import { FormDialog } from './pages';
import { DataTable, ErrorAlert, PageHeader, StatusChip } from './ui';
import { StatusTone } from './theme';

interface ScRow { id: number; documentNumber: string; status: string; customerName: string; createdByName: string; createdAt: string; pendingProposals: number; responsibleSalesName: string | null }
interface Proposal {
  id: number; productId: number; partNumber: string; name: string; status: string; reason: string; decisionNote: string | null;
  proposedByName: string; decidedByName: string | null; decidedAt: string | null;
}
interface ScLine { id: number; itemCode: string; itemName: string; uomName: string; quantity: string; products: Proposal[] }
interface ScDetail extends ScRow { customerId: number; customerCode: string; createdBy: number; version: number; responsibleSalesUserId: number | null; lines: ScLine[] }

const scTone: Record<string, StatusTone> = { DRAFT: 'neutral', ACTIVE: 'success', CANCELED: 'muted' };
const proposalTone: Record<string, StatusTone> = { PENDING: 'pending', APPROVED: 'success', REJECTED: 'danger' };

function ScStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return <StatusChip label={t(`sc.status.${status}`)} tone={scTone[status] ?? 'neutral'} />;
}

export function SalesContractsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['scs'], queryFn: () => api<ScRow[]>('/sales-contracts') });
  if (openId) return <ScDetailView id={openId} onBack={() => setOpenId(null)} />;
  const columns: GridColDef<ScRow>[] = [
    { field: 'documentNumber', headerName: t('sc.number'), width: 170 },
    { field: 'status', headerName: t('common.status'), width: 130, renderCell: (p) => <ScStatusChip status={p.value} /> },
    { field: 'customerName', headerName: t('sc.customer'), flex: 1, minWidth: 180 },
    { field: 'responsibleSalesName', headerName: t('sc.responsibleSales'), width: 170, valueFormatter: (v: string | null) => v ?? t('sc.noResponsibleSales') },
    { field: 'pendingProposals', headerName: t('sc.pendingProposals'), type: 'number', width: 150 },
    { field: 'createdByName', headerName: t('gr.createdBy'), width: 160 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  return (
    <>
      <PageHeader title={t('nav.salesContracts')}
        action={me.data?.permissions.includes('SALES_CONTRACT.CREATE') && <Button variant="contained" onClick={() => setCreating(true)}>{t('sc.create')}</Button>} />
      <Stack spacing={2}>
        <ErrorAlert error={list.error} />
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t('sc.empty')}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Stack>
      {creating && <CreateScDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}

const emptyLine: { id?: number; itemCode: string; itemName: string; uomName: string; quantity: string } = { itemCode: '', itemName: '', uomName: '', quantity: '' };

/** Create form; with `edit` it edits a DRAFT contract in place (PATCH, lines keep their ids). */
function CreateScDialog({ onClose, onCreated, edit }: { onClose: () => void; onCreated: (id: number) => void; edit?: ScDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState(edit ? String(edit.customerId) : '');
  const [responsibleSalesUserId, setResponsibleSalesUserId] = useState(edit?.responsibleSalesUserId ? String(edit.responsibleSalesUserId) : '');
  const [lines, setLines] = useState(edit ? edit.lines.map(({ id, itemCode, itemName, uomName, quantity }) => ({ id, itemCode, itemName, uomName, quantity: String(Number(quantity)) })) : [{ ...emptyLine }]);
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api<{ id: number; code: string; name: string }[]>('/customers') });
  const salesUsers = useQuery({ queryKey: ['responsible-sales'], queryFn: () => api<{ id: number; fullName: string }[]>('/sales-contracts/responsible-sales-candidates') });
  const valid = lines.every((l) => l.itemCode.trim() && l.itemName.trim() && l.uomName.trim() && Number(l.quantity) > 0);
  const create = useMutation({
    mutationFn: async () => {
      const body = { customerId: Number(customerId), responsibleSalesUserId: responsibleSalesUserId ? Number(responsibleSalesUserId) : null, lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })) };
      if (!edit) return api<{ id: number }>('/sales-contracts', { method: 'POST', body: JSON.stringify(body) });
      await api(`/sales-contracts/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ ...body, version: edit.version }) });
      return { id: edit.id };
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['scs'] }); void qc.invalidateQueries({ queryKey: ['sc', r.id] }); onCreated(r.id); },
  });
  const set = (i: number, k: keyof typeof emptyLine, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <FormDialog title={edit ? t('doc.editTitle', { number: edit.documentNumber }) : t('sc.create')} submitLabel={t(edit ? 'doc.saveEdit' : 'sc.save')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(customerId && lines.length && valid)} onSubmit={() => create.mutate()} onClose={onClose}>
      <TextField select label={t('sc.customer')} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required
        helperText={customers.data?.length === 0 ? t('sc.noCustomer') : undefined}>
        {(customers.data ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{c.code}: {c.name}</MenuItem>)}
      </TextField>
      <TextField select label={t('sc.responsibleSales')} value={responsibleSalesUserId} onChange={(e) => setResponsibleSalesUserId(e.target.value)}
        helperText={t('sc.responsibleSalesHint')}>
        <MenuItem value="">{t('sc.noResponsibleSales')}</MenuItem>
        {(salesUsers.data ?? []).map((u) => <MenuItem key={u.id} value={u.id}>{u.fullName}</MenuItem>)}
      </TextField>
      <Typography variant="body2" color="text.secondary">{t('sc.linesHint')}</Typography>
      {lines.map((l, i) => (
        <Stack key={i} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('sc.line', { n: i + 1 })}</Typography>
            {lines.length > 1 && <IconButton size="small" aria-label={t('sc.removeLine', { n: i + 1 })} onClick={() => setLines(lines.filter((_l, j) => j !== i))}>✕</IconButton>}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField label={t('sc.itemCode')} value={l.itemCode} onChange={(e) => set(i, 'itemCode', e.target.value)} required sx={{ flex: 1 }} />
            <TextField label={t('sc.itemName')} value={l.itemName} onChange={(e) => set(i, 'itemName', e.target.value)} required sx={{ flex: 2 }} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField label={t('product.uom')} value={l.uomName} onChange={(e) => set(i, 'uomName', e.target.value)} required sx={{ flex: 1 }} />
            <TextField label={t('gr.quantity')} type="number" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} required sx={{ flex: 1 }}
              slotProps={{ htmlInput: { min: 0 } }} />
          </Stack>
        </Stack>
      ))}
      <Button onClick={() => setLines([...lines, { ...emptyLine }])} sx={{ alignSelf: 'flex-start' }}>{t('sc.addLine')}</Button>
    </FormDialog>
  );
}

type Dialog = { kind: 'activate' | 'cancel' | 'edit' } | { kind: 'propose'; line: ScLine } | { kind: 'approve' | 'reject'; proposal: Proposal };

function ScDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const sc = useQuery({ queryKey: ['sc', id], queryFn: () => api<ScDetail>(`/sales-contracts/${id}`) });
  if (!sc.data || !me.data) return <ErrorAlert error={sc.error ?? me.error} />;
  const d = sc.data;
  const can = (p: string) => me.data.permissions.includes(p);
  const done = () => { setDialog(null); void qc.invalidateQueries({ queryKey: ['sc', id] }); void qc.invalidateQueries({ queryKey: ['scs'] }); };
  const actions = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button onClick={onBack}>{t('gr.back')}</Button>
      {can('SALES_CONTRACT.CREATE') && d.status !== 'CANCELED' && <Button onClick={() => setDialog({ kind: 'cancel' })}>{t('sc.cancel')}</Button>}
      {can('SALES_CONTRACT.CREATE') && d.status === 'DRAFT' && <Button onClick={() => setDialog({ kind: 'edit' })}>{t('doc.edit')}</Button>}
      {can('SALES_CONTRACT.CREATE') && d.status === 'DRAFT' && <Button variant="contained" onClick={() => setDialog({ kind: 'activate' })}>{t('sc.activate')}</Button>}
    </Stack>
  );
  return (
    <>
      <PageHeader title={`${t('sc.title')} ${d.documentNumber}`} action={actions} />
      <Stack spacing={2}>
        <Paper sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Field label={t('common.status')}><ScStatusChip status={d.status} /></Field>
            <Field label={t('sc.customer')}>{d.customerCode}: {d.customerName}</Field>
            <Field label={t('sc.responsibleSales')}>{d.responsibleSalesName ?? t('sc.noResponsibleSales')}</Field>
            <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
          </Stack>
        </Paper>
        <Typography variant="h2">{t('sc.lines')}</Typography>
        {d.lines.map((l) => (
          <Paper key={l.id} sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
                <Stack>
                  <Typography sx={{ fontWeight: 600 }}>{l.itemCode}: {l.itemName}</Typography>
                  <Typography variant="body2" color="text.secondary">{t('sc.lineQuantity', { quantity: Number(l.quantity), uom: l.uomName })}</Typography>
                </Stack>
                {can('SALES_CONTRACT.PROPOSE_PRODUCT') && d.status !== 'CANCELED' && (
                  <Button onClick={() => setDialog({ kind: 'propose', line: l })} sx={{ alignSelf: 'flex-start' }}>{t('sc.propose')}</Button>
                )}
              </Stack>
              {l.products.length === 0 && <Typography variant="body2" color="text.secondary">{t('sc.noProducts')}</Typography>}
              {l.products.map((p) => (
                <Stack key={p.id} direction={{ xs: 'column', md: 'row' }} sx={{ gap: 1, pt: 1, borderTop: 1, borderColor: 'divider', alignItems: { md: 'center' } }}>
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.partNumber}: {p.name}</Typography>
                      <StatusChip label={t(`sc.proposal.${p.status}`)} tone={proposalTone[p.status]} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">{t('sc.proposedBy', { name: p.proposedByName, reason: p.reason })}</Typography>
                    {p.decidedByName && (
                      <Typography variant="body2" color="text.secondary">
                        {t('sc.decidedBy', { name: p.decidedByName, at: fmtDate(p.decidedAt!) })}{p.decisionNote ? `. ${p.decisionNote}` : ''}
                      </Typography>
                    )}
                  </Stack>
                  {p.status === 'PENDING' && can('SALES_CONTRACT.CONFIRM_PRODUCT') && (
                    <Stack direction="row" spacing={1}>
                      <Button color="error" onClick={() => setDialog({ kind: 'reject', proposal: p })}>{t('doc.reject')}</Button>
                      <Button variant="contained" onClick={() => setDialog({ kind: 'approve', proposal: p })}>{t('gir.confirm')}</Button>
                    </Stack>
                  )}
                </Stack>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
      {dialog && (dialog.kind === 'activate' || dialog.kind === 'cancel') && <ScStatusDialog id={id} kind={dialog.kind} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'edit' && <CreateScDialog edit={d} onClose={() => setDialog(null)} onCreated={done} />}
      {dialog?.kind === 'propose' && <ProposeDialog line={dialog.line} onClose={() => setDialog(null)} onDone={done} />}
      {dialog && (dialog.kind === 'approve' || dialog.kind === 'reject') && (
        <DecideDialog proposal={dialog.proposal} approve={dialog.kind === 'approve'} onClose={() => setDialog(null)} onDone={done} />
      )}
    </>
  );
}

function ScStatusDialog({ id, kind, onClose, onDone }: { id: number; kind: 'activate' | 'cancel'; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const run = useMutation({ mutationFn: () => api(`/sales-contracts/${id}/${kind}`, { method: 'POST' }), onSuccess: onDone });
  return (
    <FormDialog title={t(`sc.${kind}`)} submitLabel={t(`sc.${kind}`)} error={run.error} pending={run.isPending} canSubmit onSubmit={() => run.mutate()} onClose={onClose}>
      <Typography variant="body2">{t(`sc.${kind}Hint`)}</Typography>
    </FormDialog>
  );
}

function ProposeDialog({ line, onClose, onDone }: { line: ScLine; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState('');
  const [reason, setReason] = useState('');
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products') });
  const taken = new Set(line.products.filter((p) => p.status !== 'REJECTED').map((p) => p.productId));
  const run = useMutation({
    mutationFn: () => api(`/sales-contract-lines/${line.id}/product-proposals`, { method: 'POST', body: JSON.stringify({ productId: Number(productId), reason }) }),
    onSuccess: onDone,
  });
  return (
    <FormDialog title={t('sc.propose')} submitLabel={t('sc.proposeSubmit')} error={run.error} pending={run.isPending}
      canSubmit={Boolean(productId && reason.trim())} onSubmit={() => run.mutate()} onClose={onClose}>
      <Typography variant="body2" color="text.secondary">{line.itemCode}: {line.itemName}</Typography>
      <TextField select label={t('gir.product')} value={productId} onChange={(e) => setProductId(e.target.value)} required>
        {(products.data ?? []).filter((p) => p.isActive && !taken.has(p.id)).map((p) => <MenuItem key={p.id} value={p.id}>{p.partNumber}: {p.name} ({p.unitOfMeasure.code})</MenuItem>)}
      </TextField>
      <TextField label={t('gr.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required multiline minRows={2} helperText={t('sc.proposeHint')} />
    </FormDialog>
  );
}

function DecideDialog({ proposal, approve, onClose, onDone }: { proposal: Proposal; approve: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const run = useMutation({
    mutationFn: () => api(`/product-proposals/${proposal.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ note: note || undefined }) }),
    onSuccess: onDone,
  });
  return (
    <FormDialog title={t(approve ? 'sc.confirmProduct' : 'sc.rejectProduct')} submitLabel={t(approve ? 'gir.confirm' : 'doc.reject')} error={run.error}
      pending={run.isPending} canSubmit onSubmit={() => run.mutate()} onClose={onClose}>
      <Typography variant="body2">{proposal.partNumber}: {proposal.name}. {proposal.reason}</Typography>
      <TextField label={t('sc.decisionNote')} value={note} onChange={(e) => setNote(e.target.value)} helperText={t('sc.decisionNoteHint')} autoFocus />
    </FormDialog>
  );
}
