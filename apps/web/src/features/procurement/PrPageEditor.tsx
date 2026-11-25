import { ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import Send from '@mui/icons-material/Send';
import Save from '@mui/icons-material/Save';
import { useTranslation } from 'react-i18next';
import { api, ApiError, catalogSelectionPath } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { DiscardDialog, RouteDiscardGuard } from '../../shared/components/FormDialog';
import { ErrorAlert } from '../../shared/components/ErrorAlert';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { trimDecimal } from '../../shared/utils/format';
import { PrLineTable } from './PrLineTable';
import type { PrDisplayLine } from './PrLineTable';
import type { DocDetail } from './types';
import type { Product } from '../master-data';
import type { ActionResult } from '../../shared/components/ActionResultDialog';

interface ContractOption {
  id: number; documentNumber: string; status: string; customerName: string; responsibleSalesUserId?: number; responsiblePmUserId?: number;
}
interface ContractLine { id: number; itemCode: string; itemName: string }
interface Candidate { id: number; fullName: string; role?: string }
interface DraftLine extends PrDisplayLine { id?: number; productId: number; salesContractLineId?: number }
export interface PrEditorModel {
  general: ReactNode; assignmentNotice: ReactNode; grid: ReactNode; footer: ReactNode;
  approver: { control: ReactNode; role?: string }; receiver: { control: ReactNode; role?: string };
  tab: string; setTab: (tab: string) => void; invalidTab: string; onBack: () => void;
}

export function PrReadonlyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return <TextField label={label} value={value || '—'} multiline={multiline} minRows={multiline ? 2 : undefined}
    slotProps={{ input: { readOnly: true } }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'action.hover' } }} />;
}

export function PrPageEditor({ detail, user, onBack, onSaved, onResult, children }: {
  detail?: DocDetail; user: { id: number; fullName?: string }; onBack: () => void;
  onSaved: (id: number, number: string, submit: boolean) => void;
  onResult: (result: ActionResult) => void; children: (model: PrEditorModel) => ReactNode;
}) {
  const { t } = useTranslation();
  const router = useContext(UNSAFE_DataRouterContext);
  const [contract, setContract] = useState(String(detail?.salesContractId ?? ''));
  const [route, setRoute] = useState('');
  const [category, setCategory] = useState(String(detail?.category ?? 'SALES_GOODS'));
  const [purpose, setPurpose] = useState(String(detail?.purpose ?? ''));
  const [approver, setApprover] = useState(String(detail?.draftApproverId ?? ''));
  const [receiver, setReceiver] = useState(String(detail?.draftReceiverId ?? ''));
  const [lines, setLines] = useState<DraftLine[]>(() => (detail?.lines ?? []).map(line => ({
    ...line, productId: line.productId!, salesContractLineId: line.sourceLineId ?? undefined,
  })));
  const [tab, setTab] = useState('general');
  const [invalid, setInvalid] = useState('');
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [deletingLine, setDeletingLine] = useState<number | null>(null);
  const [discard, setDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const state = JSON.stringify([contract, route, category, purpose, approver, receiver, lines]);
  const initial = useRef(state);
  const allowNavigation = useRef(false);
  const requestKey = useRef<string | undefined>(undefined);
  const submittedVersion = useRef(detail?.version);
  const submittedRound = useRef(detail?.approvalRound ?? 0);
  const dirty = state !== initial.current;
  const contracts = useQuery({ queryKey: ['scs'], queryFn: () => api<ContractOption[]>('/sales-contracts'), enabled: !detail });
  const options = (contracts.data ?? []).filter(option => option.status === 'ACTIVE'
    && (option.responsibleSalesUserId === user.id || option.responsiblePmUserId === user.id));
  const selected = options.find(option => String(option.id) === contract);
  const dual = selected?.responsibleSalesUserId === user.id && selected.responsiblePmUserId === user.id;
  const candidates = useQuery({
    queryKey: ['pr-draft-candidates', detail?.id, contract, route],
    queryFn: () => api<{ approvers: Candidate[]; receivers: Candidate[] }>(detail
      ? `/purchase-requisitions/${detail.id}/candidates`
      : `/pr-workflow/creator-candidates?salesContractId=${contract}${route ? `&route=${route}` : ''}`),
    enabled: Boolean(detail || (selected && (!dual || route))),
  });
  const validApprover = candidates.data?.approvers.some(person => String(person.id) === approver) ? approver : '';
  const validReceiver = candidates.data?.receivers.some(person => String(person.id) === receiver) ? receiver : '';
  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const payload = {
        purpose, ...(candidates.data && { approverId: Number(validApprover) || null, receiverId: Number(validReceiver) || null }),
        lines: lines.map(line => ({ id: line.id, productId: line.productId, salesContractLineId: line.salesContractLineId, quantity: Number(line.quantity) })),
      };
      if (!detail) return api<{ id: number; documentNumber: string }>('/purchase-requisitions/save-new', {
        method: 'POST', body: JSON.stringify({ ...payload, category, salesContractId: Number(contract), route: route || undefined,
          requestKey: requestKey.current ??= crypto.randomUUID(), submit }),
      });
      await api(`/purchase-requisitions/${detail.id}${submit ? '/submit-edited' : ''}`, {
        method: 'PATCH', body: JSON.stringify({ ...payload, version: submittedVersion.current,
          ...(submit && { round: submittedRound.current, step: 'CREATE' }) }),
      });
      return { id: detail.id, documentNumber: detail.documentNumber };
    },
    onSuccess: (data, submit) => {
      initial.current = state;
      allowNavigation.current = true;
      setConfirmation(false);
      onSaved(data.id, data.documentNumber, submit);
    },
    onError: (error, submit) => {
      setConfirmation(false);
      if (error instanceof ApiError && [400, 422].includes(error.status)) {
        const target = error.code === 'PR_CANDIDATE_NOT_ELIGIBLE' ? 'approvers' : 'general';
        setInvalid(target);
        setTab(target);
        if (target === 'approvers') void candidates.refetch();
      } else {
        onResult({ success: false, error, message: detail
          ? t(`pr.result.failure.${submit ? 'submit' : 'save'}`, { number: detail.documentNumber })
          : t(submit ? 'pr.createSubmitFailed' : 'pr.saveFailed') });
      }
    },
  });
  useEffect(() => {
    if (!dirty && !save.isPending) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!allowNavigation.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, save.isPending]);
  function validate(submit: boolean) {
    const field = !contract || (dual && !route) ? 'general' : !lines.length ? 'lines' :
      submit && (!validApprover || !validReceiver) ? 'approvers' : '';
    setInvalid(field);
    if (!field) return true;
    setTab(field === 'approvers' ? 'approvers' : 'general');
    requestAnimationFrame(() => document.getElementById(field === 'lines' ? 'pr-lines' : field === 'general'
      ? (contract ? 'pr-route' : 'pr-contract') : !validApprover ? 'pr-approver' : 'pr-receiver')?.focus());
    return false;
  }
  function change(work: () => void) {
    allowNavigation.current = false;
    work();
  }
  const general = (
    <DocumentFormGrid>
      {save.error instanceof ApiError && [400, 422].includes(save.error.status) && save.error.code !== 'PR_CANDIDATE_NOT_ELIGIBLE'
        && <DocumentFormCell><ErrorAlert error={save.error} /></DocumentFormCell>}
      <DocumentFormCell span={dual ? 4 : 5}>{detail ? <PrReadonlyField label={t('gir.salesContract')} value={String(detail.salesContractNumber ?? '')} />
        : <TextField id="pr-contract" select required label={t('gir.salesContract')} value={selected ? contract : ''} error={invalid === 'general' && !contract}
            helperText={contracts.data && !options.length ? t('pr.noActiveContract') : undefined}
            onChange={e => change(() => { setContract(e.target.value); setLines([]); setApprover(''); setReceiver(''); setRoute(''); })}>
            <MenuItem value="">{t('pr.noSelection')}</MenuItem>
            {options.map(option => <MenuItem key={option.id} value={String(option.id)}>{option.documentNumber} · {option.customerName}</MenuItem>)}
          </TextField>}</DocumentFormCell>
      <DocumentFormCell span={dual ? 2 : 3}>{detail ? <PrReadonlyField label={t('pr.category')} value={t(`category.${category}`)} />
        : <TextField select label={t('pr.category')} value={category} onChange={e => change(() => { setCategory(e.target.value); setLines([]); })}>
          {['SALES_GOODS', 'MATERIAL'].map(value => <MenuItem key={value} value={value}>{t(`category.${value}`)}</MenuItem>)}
        </TextField>}</DocumentFormCell>
      {dual && <DocumentFormCell span={2}><TextField id="pr-route" select required label={t('pr.route')} value={route} error={invalid === 'general' && !route}
        onChange={e => change(() => { setRoute(e.target.value); setApprover(''); })}>
        <MenuItem value="">{t('pr.noSelection')}</MenuItem><MenuItem value="SALES">Sales</MenuItem><MenuItem value="PM">PM</MenuItem>
      </TextField></DocumentFormCell>}
      <DocumentFormCell span={4}><PrReadonlyField label={t('pr.requester')} value={detail?.createdByName ?? user.fullName ?? ''} /></DocumentFormCell>
      {category === 'MATERIAL' && <DocumentFormCell span={8}><TextField label={t('gir.purpose')} multiline minRows={2}
        value={purpose} onChange={e => change(() => setPurpose(e.target.value))} /></DocumentFormCell>}
    </DocumentFormGrid>
  );
  const assignmentNotice = (
    <>
      {candidates.error && <ErrorAlert error={candidates.error} />}
      {save.error instanceof ApiError && save.error.code === 'PR_CANDIDATE_NOT_ELIGIBLE' && <ErrorAlert error={save.error} />}
      {candidates.data && (!candidates.data.approvers.length || !candidates.data.receivers.length)
        && <Typography variant="body2" color="text.secondary">{t('pr.emptyPool')}</Typography>}
    </>
  );
  function assignment(id: string, label: string, value: string, set: (value: string) => void, people?: Candidate[]) {
    return { role: people?.find(person => String(person.id) === value)?.role,
      control: <TextField id={id} select label={label} value={value} error={invalid === 'approvers' && !value}
          sx={{ '& .MuiInputLabel-root': { fontWeight: 600 }, '& .MuiSelect-select': { textOverflow: 'ellipsis' } }}
          onChange={e => change(() => set(e.target.value))}>
          <MenuItem value="">{t('pr.noSelection')}</MenuItem>
          {people?.map(person => <MenuItem key={person.id} value={String(person.id)} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{person.fullName}</MenuItem>)}
        </TextField> };
  }
  return <>
    {children({ general, assignmentNotice, tab, setTab, invalidTab: invalid,
      approver: assignment('pr-approver', t('gr.approver'), validApprover, setApprover, candidates.data?.approvers),
      receiver: assignment('pr-receiver', t('pr.receiver'), validReceiver, setReceiver, candidates.data?.receivers),
      onBack: () => { if (save.isPending) return; dirty ? setDiscard(true) : onBack(); },
      grid: <PrLineTable lines={lines} invalid={invalid === 'lines'}
        onAdd={() => setEditingLine(lines.length)} addDisabled={save.isPending || !contract}
        addHint={!contract ? t('pr.addGoodsNeedsContract') : undefined}
        onEdit={!save.isPending ? setEditingLine : undefined} onDelete={!save.isPending ? setDeletingLine : undefined} />,
      footer: <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button startIcon={<Save />} variant="outlined" disabled={save.isPending} onClick={() => { if (validate(false)) save.mutate(false); }}>{t('pr.saveDraft')}</Button>
        <Button startIcon={<Send />} variant="contained" disabled={save.isPending} onClick={() => { if (validate(true)) setConfirmation(true); }}>{t('doc.submit')}</Button>
      </Stack>,
    })}
    {router && <RouteDiscardGuard dirty={dirty} pending={save.isPending} allowNavigation={() => allowNavigation.current} />}
    {discard && <DiscardDialog onKeep={() => setDiscard(false)} onDiscard={() => { allowNavigation.current = true; onBack(); }} />}
    {confirmation && <FormDialog title={t('doc.confirmAction', { action: t('doc.submit') })} submitLabel={t('doc.submit')}
      submitIcon={<Send />} pageGuardsNavigation canSubmit pending={save.isPending} error={null} onClose={() => setConfirmation(false)} onSubmit={() => save.mutate(true)}>
      {t('pr.title')} {detail?.documentNumber} · {t('pr.confirmEffect.submit')}
    </FormDialog>}
    {editingLine !== null && <PrLineItemDialog line={lines[editingLine]} material={category === 'MATERIAL'} contract={contract}
      occupied={lines.filter((_, i) => i !== editingLine).map(line => line.salesContractLineId)}
      onClose={() => setEditingLine(null)} saveLine={line => change(() => {
        setLines(previous => editingLine === previous.length ? [...previous, line] : previous.map((entry, i) => i === editingLine ? line : entry));
        setInvalid(''); setEditingLine(null);
      })} />}
    {deletingLine !== null && <FormDialog title={t('pr.deleteGoods')} submitLabel={t('pr.deleteGoods')} submitColor="error"
      canSubmit pending={false} error={null} onClose={() => setDeletingLine(null)}
      onSubmit={() => change(() => { setLines(previous => previous.filter((_, i) => i !== deletingLine)); setDeletingLine(null); })}>
      {t('pr.deleteGoodsConfirm', { row: deletingLine + 1, code: lines[deletingLine]?.partNumber, name: lines[deletingLine]?.productName })}
    </FormDialog>}
  </>;
}

function PrLineItemDialog({ line, material, contract, occupied, saveLine, onClose }: {
  line?: DraftLine; material: boolean; contract: string; occupied: (number | undefined)[];
  saveLine: (line: DraftLine) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState(line?.productId ?? 0);
  const [sourceId, setSourceId] = useState(line?.salesContractLineId ?? 0);
  const [quantity, setQuantity] = useState(trimDecimal(line?.quantity ?? ''));
  const products = useQuery({ queryKey: ['products', 'selection', line?.productId], queryFn: () => api<Product[]>(catalogSelectionPath('/products', line?.productId)) });
  const contractLines = useQuery({ queryKey: ['sc-lines', contract], queryFn: () => api<ContractLine[]>(`/sales-contracts/${contract}/lines`) });
  const product = products.data?.find(item => item.id === productId && (item.isActive || item.id === line?.productId));
  const source = contractLines.data?.find(item => item.id === sourceId && !occupied.includes(item.id));
  const valid = Boolean(product && (source || (material && !sourceId)) && Number.isFinite(Number(quantity)) && Number(quantity) > 0);
  return <FormDialog title={t(line ? 'pr.editGoods' : 'pr.addGoods')} submitLabel={t('pr.saveLine')} submitIcon={<Save />}
    error={products.error ?? contractLines.error} pending={false} canSubmit={valid} onClose={onClose}
    onSubmit={() => { if (valid && product) saveLine({ id: line?.id, productId, salesContractLineId: source?.id,
      ref: source?.itemName ?? '', partNumber: product.id === line?.productId ? line.partNumber : product.partNumber,
      productName: product.id === line?.productId ? line.productName : product.name, uom: product.unitOfMeasure.code, quantity }); }}>
    <TextField select required={!material} label={t('pr.lineRef')} value={source?.id ?? 0} onChange={e => setSourceId(Number(e.target.value))}>
      <MenuItem value={0}>{t('pr.noSelection')}</MenuItem>
      {contractLines.data?.filter(item => !occupied.includes(item.id)).map(item => <MenuItem key={item.id} value={item.id}>{item.itemCode} · {item.itemName}</MenuItem>)}
    </TextField>
    <TextField select label={t('pr.product')} value={product?.id ?? 0} onChange={e => setProductId(Number(e.target.value))}>
      <MenuItem value={0}>{t('pr.noSelection')}</MenuItem>
      {products.data?.filter(item => item.isActive || item.id === line?.productId).map(item => <MenuItem key={item.id} value={item.id}>{item.partNumber} · {item.name}</MenuItem>)}
    </TextField>
    <DocumentFormGrid>
      <DocumentFormCell span={8}><PrReadonlyField label={t('product.name')} value={product?.name ?? ''} /></DocumentFormCell>
      <DocumentFormCell span={4}><PrReadonlyField label={t('product.uom')} value={product?.unitOfMeasure.code ?? ''} /></DocumentFormCell>
    </DocumentFormGrid>
    <TextField label={t('gr.quantity')} type="number" value={quantity} slotProps={{ htmlInput: { min: 0, step: 'any' } }}
      error={Boolean(quantity) && Number(quantity) <= 0} onChange={e => setQuantity(e.target.value)} />
  </FormDialog>;
}
