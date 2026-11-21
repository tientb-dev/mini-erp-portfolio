import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Stack, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ApprovalStatusChip, DataTable, DetailPageLayout, DetailTabs, Field } from '../../shared/components';
import { DocumentWorkflowNodes, DocumentWorkflowStepper } from '../../shared/components/DocumentWorkflow';
import { PrNotes } from './PrNotes';
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
  const isPr = cfg.key === 'pr';
  const receiving = status === 'WAITING_FOR_RECEIPT';
  const waiting = status === 'WAITING_FOR_APPROVE' || receiving;
  const isApprover = waiting && !isCreator && d.assignedApproverId === me.data.id
    && me.data.permissions.includes(receiving ? 'PR.RECEIVE' : `${cfg.perm}.APPROVE`);
  const canManage = isCreator && me.data.permissions.includes(`${cfg.perm}.CREATE`);
  const completed = status === (isPr ? 'DONE' : 'APPROVED');
  const activeStep = completed ? 3 : receiving ? 2 : waiting ? 1 : 0;
  const latestRound = d.nodes?.[0]?.round;
  const steps = ['CREATE', 'APPROVAL', 'RECEIPT'].map((key, index) => {
    const node = d.nodes?.find(n => n.step === key && n.round === latestRound);
    return {
      key, label: t(`pr.step.${key}`), completed: index < activeStep,
      details: index === 0 ? <Typography variant="body2">{d.createdByName} · {fmtDate(d.createdAt)}</Typography> : (
        <>
          <Field label={t('common.status')}>{node?.invalidatedAt ? t('pr.invalidated')
            : node?.result ? t(`status.${node.result}`) : index === activeStep ? t('pr.pending') : t('pr.notStarted')}</Field>
          <Field label={t('pr.department')}>{node?.department ?? '—'}</Field>
          <Field label={t('pr.assignee')}>{node?.assigneeName ?? '—'}</Field>
          <Field label={t('pr.actor')}>{node?.actorName ?? '—'}{node?.actedAt ? ` · ${fmtDate(node.actedAt)}` : ''}</Field>
        </>
      ),
    };
  });
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
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, justifyContent: 'flex-end' }}>
      <Button onClick={onBack}>{t('gr.back')}</Button>
      {canManage && (editable || completed) && <Button onClick={() => setAction('cancel')}>{t('doc.cancel')}</Button>}
      {canManage && (waiting || (!isPr && completed)) && <Button onClick={() => setAction('recall')}>{t('doc.recall')}</Button>}
      {canManage && editable && <Button onClick={() => setEditing(true)}>{t('doc.edit')}</Button>}
      {canManage && editable && <Button variant="contained" onClick={() => setAction('submit')}>{t('doc.submit')}</Button>}
      {isApprover && <Button color="error" onClick={() => setAction('reject')}>{t('doc.reject')}</Button>}
      {isApprover && <Button variant="contained" onClick={() => setAction('approve')}>{t(receiving ? 'pr.receive' : 'doc.approve')}</Button>}
    </Stack>
  );
  return (
    <>
      <DetailPageLayout
        title={t(`${cfg.key}.title`)} documentNumber={d.documentNumber}
        status={isPr ? <ApprovalStatusChip status={status} /> : undefined} actions={isPr ? undefined : actions} footer={isPr ? actions : undefined}
        notice={!isPr && waiting && !isApprover && t('doc.waitingFor', { name: d.assignedApproverName })}
      >
        {isPr && <DocumentWorkflowStepper steps={steps} active={activeStep} />}
        <DetailTabs tabs={[
          {
            key: 'general', label: t('gr.tabGeneral'), content: (
              <>
                {!isPr && <Field label={t('common.status')}><ApprovalStatusChip status={status} /></Field>}
                {cfg.fields(d, t).map(([label, value]) => <Field key={label} label={label}>{value}</Field>)}
                <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
                <Field label={t('gr.approver')}>{d.assignedApproverName ?? '—'}</Field>
                {isPr && d.children.length > 0 && <Field label={t('pr.tabChildren')}>
                  <Stack spacing={1}>
                    {d.children.map(child => (
                      <Stack key={child.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2">{child.documentNumber}</Typography>
                        <ApprovalStatusChip status={child.approvalStatus} />
                      </Stack>
                    ))}
                  </Stack>
                </Field>}
                {!isPr && <DataTable rows={d.lines} columns={lineColumns} hideFooter />}
              </>
            ),
          },
          {
            // Child documents need the page's own VIEW; a contract-scoped reader gets none from the API (ADR-0014).
            key: 'children', label: t(`${cfg.key}.tabChildren`), hidden: isPr || !me.data.permissions.includes(`${cfg.perm}.VIEW`), content: d.children.length
              ? d.children.map((c) => (
                  <Stack key={c.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: 170 }}>{c.documentNumber}</Typography><ApprovalStatusChip status={c.approvalStatus} />
                  </Stack>
                ))
              : <Typography variant="body2" color="text.secondary">{t(`${cfg.key}.noChildren`)}</Typography>,
          },
          { key: 'approvers', label: t('pr.approvers'), hidden: !isPr, content: <DocumentWorkflowNodes steps={steps} /> },
          { key: 'notes', label: t('pr.notes'), hidden: !isPr, content: <PrNotes id={id} notes={d.notes ?? []} onSaved={() => void doc.refetch()} /> },
          { key: 'history', label: t(isPr ? 'pr.history' : 'gr.tabApprovers'), content: <HistoryList history={d.history} /> },
        ]} />
        {isPr && <DataTable rows={d.lines} columns={lineColumns} hideFooter />}
      </DetailPageLayout>
      {editing && <cfg.Create edit={d} onClose={() => setEditing(false)} onCreated={() => { setEditing(false); void qc.invalidateQueries({ queryKey: [cfg.key] }); }} />}
      {action && (
        <DocActionDialog basePath={`/${cfg.path}/${id}`} action={action} approversPath={isPr ? undefined : `/${cfg.path}/${id}/approvers`} approved={completed} receive={receiving && action === 'approve'}
          version={isPr && action !== 'submit' ? d.version : undefined}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); void qc.invalidateQueries({ queryKey: [cfg.key] }); }} />
      )}
    </>
  );
}
