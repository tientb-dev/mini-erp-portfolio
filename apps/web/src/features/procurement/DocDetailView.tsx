import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Stack, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ApprovalStatusChip, DataTable, DetailPageLayout, DetailTabs, Field } from '../../shared/components';
import { fmtDate, num } from '../../shared/utils/format';
import { useMe } from '../identity';
import { DocAction, DocActionDialog, HistoryList } from '../workflow';
import { DocConfig, DocDetail, DocLine } from './types';

export function DocDetailView({ cfg, id, onBack }: { cfg: DocConfig; id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [action, setAction] = useState<DocAction | null>(null);
  const [editing, setEditing] = useState(false);
  const doc = useQuery({ queryKey: [cfg.key, id], queryFn: () => api<DocDetail>(`/${cfg.path}/${id}`) });
  if (!doc.data || !me.data) return <DetailPageLayout title={t(`${cfg.key}.title`)} loading error={doc.error ?? me.error} />;
  const d = doc.data;
  const status = d.approvalStatus;
  const isCreator = d.createdBy === me.data.id;
  const isApprover = status === 'WAITING_FOR_APPROVE' && d.assignedApproverId === me.data.id;
  const editable = ['DRAFT', 'REJECTED'].includes(status);
  const hasUsed = d.lines.some((l) => l.usedQuantity !== undefined);
  const hasReceived = d.lines.some((l) => l.receivedQuantity !== undefined);
  const lineColumns: GridColDef<DocLine>[] = [
    { field: 'ref', headerName: t(`${cfg.key}.lineRef`), flex: 1, minWidth: 150 },
    { field: 'partNumber', headerName: t('product.partNumber'), width: 150 },
    { field: 'productName', headerName: t('product.name'), flex: 1, minWidth: 160 },
    { field: 'quantity', headerName: t('gr.quantity'), type: 'number', width: 110, valueGetter: (v: string) => num(v) },
    ...(hasUsed ? [{ field: 'usedQuantity', headerName: t(`${cfg.key}.used`), type: 'number' as const, width: 130, valueGetter: (v: string) => num(v) }] : []),
    ...(hasReceived ? [{ field: 'receivedQuantity', headerName: t('po.received'), type: 'number' as const, width: 120, valueGetter: (v: string) => num(v) }] : []),
    { field: 'uom', headerName: t('product.uom'), width: 70 },
  ];
  const actions = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button onClick={onBack}>{t('gr.back')}</Button>
      {isCreator && (editable || status === 'APPROVED') && <Button onClick={() => setAction('cancel')}>{t('doc.cancel')}</Button>}
      {isCreator && ['WAITING_FOR_APPROVE', 'APPROVED'].includes(status) && <Button onClick={() => setAction('recall')}>{t('doc.recall')}</Button>}
      {isCreator && editable && <Button onClick={() => setEditing(true)}>{t('doc.edit')}</Button>}
      {isCreator && editable && <Button variant="contained" onClick={() => setAction('submit')}>{t('doc.submit')}</Button>}
      {isApprover && <Button color="error" onClick={() => setAction('reject')}>{t('doc.reject')}</Button>}
      {isApprover && <Button variant="contained" onClick={() => setAction('approve')}>{t('doc.approve')}</Button>}
    </Stack>
  );
  return (
    <>
      <DetailPageLayout
        title={t(`${cfg.key}.title`)} documentNumber={d.documentNumber} actions={actions}
        notice={status === 'WAITING_FOR_APPROVE' && !isApprover && t('doc.waitingFor', { name: d.assignedApproverName })}
      >
        <DetailTabs tabs={[
          {
            key: 'general', label: t('gr.tabGeneral'), content: (
              <>
                <Field label={t('common.status')}><ApprovalStatusChip status={status} /></Field>
                {cfg.fields(d, t).map(([label, value]) => <Field key={label} label={label}>{value}</Field>)}
                <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
                <Field label={t('gr.approver')}>{d.assignedApproverName ?? '—'}</Field>
                <DataTable rows={d.lines} columns={lineColumns} hideFooter />
              </>
            ),
          },
          {
            key: 'children', label: t(`${cfg.key}.tabChildren`), content: d.children.length
              ? d.children.map((c) => (
                  <Stack key={c.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: 170 }}>{c.documentNumber}</Typography><ApprovalStatusChip status={c.approvalStatus} />
                  </Stack>
                ))
              : <Typography variant="body2" color="text.secondary">{t(`${cfg.key}.noChildren`)}</Typography>,
          },
          { key: 'history', label: t('gr.tabApprovers'), content: <HistoryList history={d.history} /> },
        ]} />
      </DetailPageLayout>
      {editing && <cfg.Create edit={d} onClose={() => setEditing(false)} onCreated={() => { setEditing(false); void qc.invalidateQueries({ queryKey: [cfg.key] }); }} />}
      {action && (
        <DocActionDialog basePath={`/${cfg.path}/${id}`} action={action} approversPath={`/${cfg.path}/${id}/approvers`} approved={status === 'APPROVED'}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); void qc.invalidateQueries({ queryKey: [cfg.key] }); }} />
      )}
    </>
  );
}
