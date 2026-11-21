import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { api } from '../../services/api-client';
import { DetailPageLayout, DetailTabs, PageBreadcrumbs } from '../../shared/components';
import { fmtDate } from '../../shared/utils/format';
import { useMe } from '../identity';
import { DecideDialog, DeleteLineDialog, ProposeDialog, ScStatusDialog } from './ScDialogs';
import { ScHeaderDialog } from './ScHeaderDialog';
import { ScLineDialog } from './ScLineDialog';
import { LineAction, ScLinesTab } from './ScLinesTab';
import { ScPrsTab } from './ScPrsTab';
import { ScStatusChip } from './ScStatusChip';
import { listUrl, ScDetail } from './types';

/** Label above value; an optional second line (code, time) in the muted colour. */
function InfoItem({ label, value, detail, muted }: { label: string; value: string; detail?: string; muted?: boolean }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 500, color: muted ? 'text.secondary' : 'text.primary', overflowWrap: 'anywhere' }}>{value}</Typography>
      {detail && <Typography variant="body2" color="text.secondary">{detail}</Typography>}
    </Stack>
  );
}

type Dialog = LineAction | { kind: 'activate' | 'cancel' | 'header' };

/**
 * HĐ detail: header always visible, tabs Hàng hóa (default) and Đề nghị mua hàng. Every save (header, one line, status)
 * is its own API call; there is no "save all". No History tab: the backend keeps no audit trail for HĐ yet.
 */
export function ScDetailView({ id }: { id: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const sc = useQuery({ queryKey: ['sc', id], queryFn: () => api<ScDetail>(`/sales-contracts/${id}`) });
  const d = sc.data;
  const can = (p: string) => Boolean(me.data?.permissions.includes(p));
  const close = () => setDialog(null);
  const done = () => { close(); void qc.invalidateQueries({ queryKey: ['sc', id] }); void qc.invalidateQueries({ queryKey: ['scs'] }); };
  const breadcrumbs = (
    <PageBreadcrumbs items={[{ label: t('common.home'), to: '/' }, { label: t('nav.sales') }, { label: t('nav.salesContracts'), to: listUrl() }, { label: d?.documentNumber ?? '…' }]} />
  );
  const manage = can('SALES_CONTRACT.CREATE');
  // Header keeps only secondary actions; the decision (Chốt) sits in the bottom bar.
  // Header: only Sửa thông tin (DRAFT). Decisions (Hủy, Chốt) share the bottom bar, right-aligned.
  const actions = d && manage && d.status === 'DRAFT' && (
    <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => setDialog({ kind: 'header' })}>{t('sc.editHeader')}</Button>
  );
  // Same conditions the server checks on activate: at least one line and a responsible sales.
  const blocker = d && (!d.lines.length ? t('sc.activateNeedLines') : !d.responsibleSalesUserId ? t('sc.activateNeedSales') : null);
  const draft = d?.status === 'DRAFT';
  const footer = d && manage && d.status !== 'CANCELED' && (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} sx={{ alignItems: { sm: 'center' }, justifyContent: 'flex-end' }}>
      {draft && (
        <Typography variant="body2" color={blocker ? 'warning.main' : 'text.secondary'}
          sx={{ textAlign: { sm: 'right' }, display: { xs: blocker ? 'block' : 'none', sm: 'block' } }}>{blocker ?? t('sc.activateBar')}</Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0, justifyContent: 'flex-end', '& > *': { flex: { xs: 1, sm: 'none' } } }}>
        <Button variant="outlined" color="error" onClick={() => setDialog({ kind: 'cancel' })}>{t('sc.cancel')}</Button>
        {draft && <Button variant="contained" disabled={Boolean(blocker)} onClick={() => setDialog({ kind: 'activate' })}>{t('sc.activate')}</Button>}
      </Stack>
    </Stack>
  );
  // PR tab: PR.VIEW, or read-only for the responsible sales of this contract (ADR-0014; the API checks the same rule).
  const seesPrs = Boolean(d && me.data && (can('PR.VIEW') || (can('SALES_CONTRACT.VIEW') && d.responsibleSalesUserId === me.data.id)));
  return (
    <DetailPageLayout title={d?.documentNumber ?? t('sc.title')} loading={!d || !me.data} error={sc.error ?? me.error}
      status={d && <ScStatusChip status={d.status} />} subtitle={t('sc.title')}
      breadcrumbs={breadcrumbs} backTo={listUrl()} actions={actions} footer={footer}>
      {d && (
        <>
          <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
            <Box sx={{ display: 'grid', gap: { xs: 2, md: 3 }, gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
              <InfoItem label={t('sc.customer')} value={d.customerName} detail={d.customerCode} />
              <InfoItem label={t('sc.responsibleSales')} value={d.responsibleSalesName ?? t('sc.noResponsibleSales')} muted={!d.responsibleSalesName} />
              <InfoItem label={t('gr.createdBy')} value={d.createdByName} detail={fmtDate(d.createdAt)} />
              <InfoItem label={t('sc.updatedBy')} value={(d.updatedAt && d.updatedByName) || '—'} detail={d.updatedAt ? fmtDate(d.updatedAt) : undefined} />
            </Box>
          </Paper>
          <DetailTabs tabs={[
            { key: 'lines', label: `${t('sc.tabLines')} (${d.lines.length})`, content: <ScLinesTab d={d} can={can} onAction={setDialog} /> },
            { key: 'prs', label: t('sc.tabPrs'), hidden: !seesPrs, content: <ScPrsTab contractId={d.id} /> },
          ]} />
          {(dialog?.kind === 'activate' || dialog?.kind === 'cancel') && <ScStatusDialog id={id} kind={dialog.kind} onClose={close} onDone={done} />}
          {dialog?.kind === 'header' && <ScHeaderDialog edit={d} onClose={close} onSaved={done} />}
          {dialog?.kind === 'add' && <ScLineDialog contractId={id} version={d.version} onClose={close} onSaved={done} />}
          {dialog?.kind === 'edit' && <ScLineDialog contractId={id} version={d.version} line={dialog.line} onClose={close} onSaved={done} />}
          {dialog?.kind === 'delete' && <DeleteLineDialog line={dialog.line} version={d.version} onClose={close} onDone={done} />}
          {dialog?.kind === 'propose' && <ProposeDialog line={dialog.line} onClose={close} onDone={done} />}
          {(dialog?.kind === 'approve' || dialog?.kind === 'reject') && (
            <DecideDialog proposal={dialog.proposal} approve={dialog.kind === 'approve'} onClose={close} onDone={done} />
          )}
        </>
      )}
    </DetailPageLayout>
  );
}
