import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { ApprovalStatusChip, ErrorAlert, Field, PageHeader } from '../../shared/components';
import { fmtDate, num } from '../../shared/utils/format';
import { useMe } from '../identity';
import { DocAction, DocActionDialog, HistoryList } from '../workflow';
import { ExecutionChip } from './ExecutionChip';
import { GiDetail } from './types';

export function GiDetailView({ id, onBack }: { id: number; onBack: () => void }) {
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
