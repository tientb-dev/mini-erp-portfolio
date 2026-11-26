import { useCallback, useContext, useEffect, useState } from 'react';
import { UNSAFE_DataRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Stack, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { ApiError, api } from '../../services/api-client';
import { ApprovalStatusChip, DataTable, DetailPageLayout, DetailTabs, Field } from '../../shared/components';
import { DocumentWorkflowNodes, DocumentWorkflowStepper, WorkflowCardField } from '../../shared/components/DocumentWorkflow';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { StatusChip } from '../../shared/components/StatusChip';
import type { WorkflowStepState } from '../../shared/components/DocumentWorkflow';
import { PrNotes } from './PrNotes';
import { DocumentRecordList } from '../../shared/components/DocumentRecordList';
import { ActionResultDialog } from '../../shared/components/ActionResultDialog';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import SwapHoriz from '@mui/icons-material/SwapHoriz';
import { fmtDate, num } from '../../shared/utils/format';
import { useMe } from '../identity';
import type { HistoryEntry, WorkflowActionContext } from '../workflow';
import { DocAction, DocActionDialog, DocumentActivityDialog, DocumentHistoryTable, HistoryList } from '../workflow';
import { DocConfig, DocDetail, DocLine } from './types';
import { PrPageEditor, PrReadonlyField, type PrEditorModel } from './PrPageEditor';
import { formatDocumentDate } from '../../shared/utils/document-date';
import { displayDocumentNumber } from '../../shared/components/DocumentNumericInput';
import { PrLineTable } from './PrLineTable';
import { fromSavedPrLine } from './pr-lines';
import { PrDossierPanel } from './PrDossierPanel';
import { usePrDossier } from './pr-dossier';
import { FormDialog, RouteDiscardGuard } from '../../shared/components/FormDialog';
import { ActionButton } from '../../shared/components/ActionButton';

const stepTones = { future: 'neutral', pending: 'pending', completed: 'success', rejected: 'danger' } as const;

export function DocDetailView({ cfg, id, onBack }: { cfg: DocConfig; id: number; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const router = useContext(UNSAFE_DataRouterContext);
  const [action, setAction] = useState<{ action: DocAction; context?: WorkflowActionContext; completed: boolean; assignee?: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(location.state?.prResult ?? null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [reason, setReason] = useState<HistoryEntry | null>(null);
  const creating = id === 0 && cfg.key === 'pr';
  const doc = useQuery({ queryKey: [cfg.key, id], queryFn: () => api<DocDetail>(`/${cfg.path}/${id}`), enabled: !creating });
  const dossier = usePrDossier(id, cfg.key === 'pr' && Boolean(me.data) && (creating || Boolean(doc.data)),
    Boolean(me.data?.permissions.includes('PR.DOSSIER_MANAGE')));
  const [viewTab, setViewTab] = useState('general');
  const [workflowWarning, setWorkflowWarning] = useState(false);
  const editorActive = cfg.key === 'pr' && (creating || Boolean(doc.data && me.data && doc.data.canEdit !== false
    && doc.data.createdBy === me.data.id && me.data.permissions.includes('PR.CREATE')
    && ['DRAFT', 'REJECTED'].includes(doc.data.approvalStatus)));
  const dossierSave = useMutation({ mutationFn: dossier.save, onSuccess: () => {
    setResult({ success: true, title: t('prDossier.savedTitle'),
      message: t('prDossier.saved', { number: doc.data?.documentNumber }) });
    void doc.refetch();
  }, onError: error => {
    const status = error instanceof ApiError ? error.status : undefined;
    const hint = status === 409 ? 'saveConflict' : status === 404 ? 'saveMissingFile' : status === 403 ? 'savePermission' : 'saveRetry';
    setResult({ success: false, title: t('prDossier.saveFailed'), hint: t(`prDossier.${hint}`), error });
  } });
  const viewGuard = !editorActive && (dossier.dirty || dossier.pending || dossierSave.isPending);
  useEffect(() => {
    if (!viewGuard) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [viewGuard]);
  const fromCreate = Boolean(location.state?.prResult);
  const closeResult = useCallback(() => {
    setResult(null);
    if (fromCreate) navigate(location.pathname + location.search, { replace: true, state: null });
    void qc.invalidateQueries({ queryKey: [cfg.key, id] });
  }, [cfg.key, id, qc, fromCreate, navigate, location.pathname, location.search]);
  if (!me.data || (!creating && !doc.data)) return <DetailPageLayout title={t(`${cfg.key}.title`)} loading error={doc.error ?? me.error} />;
  const d: DocDetail = doc.data ?? {
    id: 0, documentNumber: '', approvalStatus: 'DRAFT', version: 0, createdBy: me.data.id,
    createdByName: me.data.fullName ?? '', assignedApproverId: null, assignedApproverName: null,
    createdAt: '', lines: [], children: [], history: [],
  };
  const status = d.approvalStatus;
  const isCreator = d.createdBy === me.data.id;
  const isPr = cfg.key === 'pr';
  const receiving = status === 'WAITING_FOR_RECEIPT';
  const waiting = status === 'WAITING_FOR_APPROVE' || receiving;
  const isApprover = waiting && !isCreator && d.assignedApproverId === me.data.id
    && me.data.permissions.includes(receiving ? 'PR.RECEIVE' : `${cfg.perm}.APPROVE`);
  const canManage = isCreator && me.data.permissions.includes(`${cfg.perm}.CREATE`);
  const completed = status === (isPr ? 'DONE' : 'APPROVED');
  const openAction = (action: DocAction) => {
    if (isPr && (dossier.dirty || dossier.pending || dossierSave.isPending)) { setWorkflowWarning(true); return; }
    setAction({ action, completed, assignee: d.assignedApproverName, context: isPr ? {
      version: d.version, round: d.approvalRound ?? 0, step: receiving ? 'RECEIPT' : waiting ? 'APPROVAL' : editable ? 'CREATE' : 'CLOSED',
    } : undefined });
  };
  const activeStep = completed ? 3 : receiving ? 2 : waiting ? 1 : 0;
  const latestRound = d.approvalRound ?? d.nodes?.[0]?.round;
  const steps = ['CREATE', 'APPROVAL', 'RECEIPT'].map((key, index) => {
    const node = d.nodes?.find(n => n.step === key && n.round === latestRound);
    const state: WorkflowStepState = index === 0 ? status === 'DRAFT' ? 'pending' : 'completed'
      : node?.invalidatedAt ? 'future'
      : node?.result === 'REJECTED' ? 'rejected'
      : node?.result === 'APPROVED' ? 'completed'
      : waiting && index === activeStep ? 'pending' : 'future';
    return {
      key, label: t(`pr.step.${key}`), state,
      details: (editor?: PrEditorModel) => {
        const assignment = index === 1 ? editor?.approver : index === 2 ? editor?.receiver : undefined;
        return <>
        <WorkflowCardField label={t(index === 0 ? 'gr.createdBy' : index === 1 ? 'gr.approver' : 'pr.receiver')}
          control={assignment?.control} alignControl={Boolean(editor)}
          value={index === 0 ? d.createdByName : node?.actorName ?? node?.assigneeName} />
        <WorkflowCardField label={t('pr.workflowRole')} value={index === 0 ? d.creatorRole : assignment ? assignment.role : node?.department} />
        <WorkflowCardField label={t(index === 0 ? 'pr.createdAt' : 'pr.processedAt')}
          value={index === 0 && d.createdAt ? fmtDate(d.createdAt) : node?.actedAt ? fmtDate(node.actedAt) : null} />
        <WorkflowCardField label={t('common.status')} badge={index === 0 ? <ApprovalStatusChip status={status} />
          : <StatusChip label={t(node?.invalidatedAt ? 'pr.invalidated' : `pr.stepState.${state}`)}
              tone={node?.invalidatedAt ? 'muted' : stepTones[state]} />} />
        </>;
      },
      action: state === 'rejected' && d.rejection
        ? <Button variant="outlined" startIcon={<InfoOutlined />} onClick={() => setReason(d.rejection ?? null)}>{t('pr.viewReason')}</Button>
        : isPr && d.canReassign && state === 'pending' && index > 0
          ? <Button variant="outlined" startIcon={<SwapHoriz />} onClick={() => openAction('reassign')}>{t('doc.reassign')}</Button>
          : undefined,
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
  const cancel = canManage && (isPr ? d.canCancel : editable || completed)
    ? <ActionButton action="void" onClick={() => openAction('cancel')}>{t('doc.cancel')}</ActionButton>
    : null;
  const actions = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, justifyContent: 'flex-end' }}>
      {!isPr && <Button onClick={onBack}>{t('gr.back')}</Button>}
      {cancel}
      {canManage && (waiting || (!isPr && completed)) && <ActionButton action="refresh" onClick={() => openAction('recall')}>{t('doc.recall')}</ActionButton>}
      {!isPr && canManage && editable && <ActionButton action="edit" variant="outlined" onClick={() => setEditing(true)}>{t('doc.edit')}</ActionButton>}
      {!isPr && canManage && editable && <ActionButton action="submit" onClick={() => openAction('submit')}>{t('doc.submit')}</ActionButton>}
      {isApprover && <ActionButton action="reject" onClick={() => openAction('reject')}>{t('doc.reject')}</ActionButton>}
      {isApprover && <ActionButton action="confirm" onClick={() => openAction(receiving ? 'receive' : 'approve')}>{t(receiving ? 'pr.receive' : 'doc.approve')}</ActionButton>}
    </Stack>
  );
  const renderPage = (editor?: PrEditorModel) => (
      <DetailPageLayout
        title={t(creating ? 'pr.createTitle' : `${cfg.key}.title`)} documentNumber={d.documentNumber}
        subtitle={isPr ? String(d.purpose || d.customerName || '') : undefined}
        onBack={isPr ? editor?.onBack ?? onBack : undefined} backLabel={t('pr.backToList')}
        naturalFlow={isPr}
        status={isPr && !creating ? <ApprovalStatusChip status={status} prominent /> : undefined} actions={isPr ? undefined : actions}
        footer={editor ? <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>{cancel}{editor.footer}</Stack>
          : isPr && (isApprover || cancel || (canManage && waiting)) ? actions : undefined}
        notice={!isPr && waiting && !isApprover && t('doc.waitingFor', { name: d.assignedApproverName })}
      >
        {isPr && <DocumentWorkflowStepper steps={steps} caption={latestRound ? t('pr.round', { round: latestRound }) : undefined} />}
        <DetailTabs value={editor?.tab ?? (isPr ? viewTab : undefined)} onChange={editor?.setTab ?? (isPr ? setViewTab : undefined)}
          below={isPr ? editor?.grid ?? <PrLineTable lines={d.lines.map(fromSavedPrLine)} currency={String(d.currencyCode ?? '')}
            scale={Number(d.currencyDecimalPlaces ?? 0)} official={[d.subtotal, d.taxTotal, d.total].map(value => value == null ? null : String(value)) as [string | null, string | null, string | null]} /> : undefined} tabs={[
          {
            key: 'general', label: t('gr.tabGeneral'), invalid: editor?.invalidTab === 'general', content: editor?.general ?? (
              <>
                {!isPr && <Field label={t('common.status')}><ApprovalStatusChip status={status} /></Field>}
                {isPr ? <DocumentFormGrid compact>
                  <DocumentFormCell span={8}><PrReadonlyField label={t('prPhase.name')} value={String(d.name ?? '')} /></DocumentFormCell>
                  <DocumentFormCell span={4}><PrReadonlyField label={t('pr.requester')} value={String(d.requesterName ?? d.createdByName ?? '')} /></DocumentFormCell>
                  <DocumentFormCell span={3}><PrReadonlyField label={t('pr.category')} value={t(`category.${d.category}`)} /></DocumentFormCell>
                  <DocumentFormCell span={5}><PrReadonlyField label={t('gir.salesContract')} value={[d.salesContractNumber, d.customerName].filter(Boolean).join(' · ')} /></DocumentFormCell>
                  <DocumentFormCell span={2}><PrReadonlyField label={t('prPhase.requisitionDate')} value={formatDocumentDate(String(d.requisitionDate ?? ''), i18n.language)} /></DocumentFormCell>
                  <DocumentFormCell span={2}><PrReadonlyField label={t('prPhase.requiredDate')} value={formatDocumentDate(String(d.requiredDate ?? ''), i18n.language)} /></DocumentFormCell>
                  <DocumentFormCell><Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap', '& > *': { width: 168 } }}>
                  <PrReadonlyField label={t('prPhase.currency')} value={String(d.currencyCode ?? '')} />
                  <PrReadonlyField label={t('prPhase.rateSource')} value={d.exchangeRateSource ? t(d.exchangeRateSource === 'MANUAL' ? 'prPhase.manual' : 'prPhase.catalogRate') : ''} />
                  <PrReadonlyField label={t('prPhase.rate')} value={displayDocumentNumber(String(d.exchangeRate ?? ''), i18n.language, 8, true)} />
                  </Stack></DocumentFormCell>
                  <DocumentFormCell span={6}><PrReadonlyField label={t('prPhase.purpose')} value={String(d.purpose ?? '')} multiline /></DocumentFormCell>
                  <DocumentFormCell span={6}><PrReadonlyField label={t('prPhase.description')} value={String(d.description ?? '')} multiline /></DocumentFormCell>
                </DocumentFormGrid> : <>
                  {cfg.fields(d, t).map(([label, value]) => <Field key={label} label={label}>{value}</Field>)}
                  <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
                </>}
                {!isPr && <Field label={t('gr.approver')}>{d.assignedApproverName ?? '—'}</Field>}
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
          { key: 'dossier', label: t('pr.dossier'), hidden: !isPr, invalid: editor?.invalidTab === 'dossier',
            content: <PrDossierPanel model={dossier} saving={editor?.saving ?? dossierSave.isPending}
              onSave={editor ? undefined : () => dossierSave.mutate()} onResult={setResult}
              templateConflict={editor?.templateConflict} onTemplateResolved={editor?.onTemplateResolved} /> },
          { key: 'approvers', label: t('pr.approvers'), invalid: editor?.invalidTab === 'approvers', hidden: !isPr,
            content: <>{editor?.assignmentNotice}<DocumentWorkflowNodes steps={steps.map(step => ({ ...step, details: step.details(editor) }))} /></> },
          { key: 'notes', label: t('pr.notes'), hidden: !isPr || creating, content: <PrNotes id={id} notes={d.notes ?? []} nextCursor={d.notesCursor} onSaved={() => void doc.refetch()} /> },
          { key: 'history', label: t(isPr ? 'pr.history' : 'gr.tabApprovers'), hidden: creating, content: isPr
            ? <DocumentRecordList key={`${id}-${d.version}`} path={`/${cfg.path}/${id}/history`} items={d.history}
                nextCursor={d.historyCursor} render={history => <DocumentHistoryTable history={history} />} />
            : <HistoryList history={d.history} /> },
        ]} />
      </DetailPageLayout>
  );
  const LegacyEditor = cfg.Create;
  return (
    <>
      {editorActive
        ? <PrPageEditor key={editorRevision} detail={creating ? undefined : d} user={me.data} onBack={onBack} dossier={dossier}
            onResult={setResult} onSaved={(savedId, number, submit) => {
              const outcome: ActionResult = { success: true,
                message: t(`pr.result.success.${submit ? 'submit' : creating ? 'create' : 'save'}`, { number }),
                status: submit ? t('pr.resultStatus', { status: t('status.WAITING_FOR_APPROVE') }) : undefined };
              void qc.invalidateQueries({ queryKey: ['pr', 'list'] });
              void qc.invalidateQueries({ queryKey: ['/purchase-requisitions'] });
              void qc.invalidateQueries({ queryKey: ['sc-prs'] });
              void qc.invalidateQueries({ queryKey: ['pr-dossier', savedId] });
              if (submit) void qc.invalidateQueries({ queryKey: ['pr-notifications'] });
              if (creating) navigate(`/${cfg.path}/${savedId}${location.search}`, { replace: true, state: { prResult: outcome } });
              else {
                setResult(outcome);
                void doc.refetch().then(response => { if (response.isSuccess) setEditorRevision(n => n + 1); });
              }
            }}>{renderPage}</PrPageEditor>
        : renderPage()}
      {reason && <DocumentActivityDialog title={t('pr.viewReason')} entry={reason} onClose={() => setReason(null)} />}
      {router && isPr && !editorActive && <RouteDiscardGuard dirty={dossier.dirty} pending={dossier.pending || dossierSave.isPending} />}
      {workflowWarning && <FormDialog title={t('prDossier.dirty')} closeLabel={t('prDossier.continueEditing')}
        submitLabel={dossier.dirty ? t('common.discard') : undefined} submitAction="delete"
        pageGuardsNavigation canSubmit={!dossier.pending && !dossierSave.isPending} pending={false} error={null}
        onClose={() => setWorkflowWarning(false)} onSubmit={() => { dossier.revert(); setWorkflowWarning(false); }}>
        {t('prDossier.workflowWarning')}
      </FormDialog>}
      {result && <ActionResultDialog result={result} onClose={closeResult} />}
      {editing && LegacyEditor && <LegacyEditor edit={d} onClose={() => setEditing(false)} onCreated={() => { setEditing(false); void qc.invalidateQueries({ queryKey: [cfg.key] }); }} />}
      {action && (
        <DocActionDialog basePath={`/${cfg.path}/${id}`} action={action.action} approversPath={isPr ? undefined : `/${cfg.path}/${id}/approvers`} approved={action.completed} context={action.context}
          currentAssignee={action.assignee}
          document={isPr ? { type: t('pr.title'), number: d.documentNumber } : undefined}
          onResult={isPr ? outcome => {
            setAction(null);
            const nextStatus: Partial<Record<DocAction, string>> = {
              approve: 'WAITING_FOR_RECEIPT', receive: 'DONE', recall: 'DRAFT', reject: 'REJECTED', cancel: 'CANCELED',
            };
            setResult(outcome.success ? {
              ...outcome, message: t(`pr.result.success.${action.action}`, { number: d.documentNumber }),
              status: nextStatus[action.action] ? t('pr.resultStatus', { status: t(`status.${nextStatus[action.action]}`) }) : undefined,
            } : { ...outcome, message: t(`pr.result.failure.${action.action}`, { number: d.documentNumber }) });
          } : undefined}
          draftCandidates={isPr ? { approverId: d.draftApproverId, receiverId: d.draftReceiverId } : undefined}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            void qc.invalidateQueries({ queryKey: [cfg.key] });
            if (isPr) {
              void qc.invalidateQueries({ queryKey: ['/purchase-requisitions'] });
              void qc.invalidateQueries({ queryKey: ['sc-prs'] });
              void qc.invalidateQueries({ queryKey: ['pr-notifications'] });
            }
          }} />
      )}
    </>
  );
}
