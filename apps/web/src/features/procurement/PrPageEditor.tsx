import { ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Autocomplete, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { DiscardDialog, RouteDiscardGuard } from '../../shared/components/FormDialog';
import { ErrorAlert } from '../../shared/components/ErrorAlert';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { trimDecimal } from '../../shared/utils/format';
import { PrLineEditor, PrLineTable } from './PrLineTable';
import { DocumentDatePicker } from '../../shared/components/DocumentDatePicker';
import { DocumentNumericInput } from '../../shared/components/DocumentNumericInput';
import { BulkDeleteRows } from '../../shared/components/BulkDeleteRows';
import { SearchAutocompleteInput } from '../../shared/components/SearchInput';
import { ProductPicker } from '../../shared/components/ProductPicker';
import { useDebouncedText } from '../../shared/utils/server-list';
import { ContractLine, PrLine, decimalInput, fromPickedProduct, fromSavedPrLine, positiveDecimal, prLineErrors } from './pr-lines';
import type { DocDetail } from './types';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { ActionButton } from '../../shared/components/ActionButton';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import type { PrDossierModel } from './pr-dossier';

interface ContractOption {
  id: number; documentNumber: string; status: string; customerName: string; responsibleSalesUserId?: number; responsiblePmUserId?: number;
}
const contractLabel = (option: ContractOption) => option.documentNumber + ' · ' + option.customerName;
interface Candidate { id: number; fullName: string; role?: string }
interface Currency { id: number; code: string; exchangeRate: string; decimalPlaces: number }
const today = () => {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(value => String(value).padStart(2, '0')).join('-');
};
export interface PrEditorModel {
  general: ReactNode; assignmentNotice: ReactNode; grid: ReactNode; footer: ReactNode;
  approver: { control: ReactNode; role?: string }; receiver: { control: ReactNode; role?: string };
  tab: string; setTab: (tab: string) => void; invalidTab: string; onBack: () => void;
  saving: boolean; templateConflict: boolean; onTemplateResolved: () => void;
}

export function PrReadonlyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return <ReadOnlyField label={label} value={value} multiline={multiline} minRows={multiline ? 2 : undefined} />;
}

export function PrPageEditor({ detail, user, onBack, onSaved, onResult, dossier, children }: {
  detail?: DocDetail; user: { id: number; fullName?: string }; onBack: () => void;
  onSaved: (id: number, number: string, submit: boolean) => void;
  onResult: (result: ActionResult) => void; children: (model: PrEditorModel) => ReactNode;
  dossier: PrDossierModel;
}) {
  const { t } = useTranslation();
  const router = useContext(UNSAFE_DataRouterContext);
  const [contract, setContract] = useState(String(detail?.salesContractId ?? ''));
  const [route, setRoute] = useState('');
  const [category, setCategory] = useState(String(detail?.category ?? ''));
  const [name, setName] = useState(String(detail?.name ?? ''));
  const [nameRequired, setNameRequired] = useState(false);
  const [requisitionDate, setRequisitionDate] = useState(String(detail ? detail.requisitionDate ?? '' : today()));
  const [validDates, setValidDates] = useState([true, true]);
  const [requiredDate, setRequiredDate] = useState(String(detail?.requiredDate ?? ''));
  const [description, setDescription] = useState(String(detail?.description ?? ''));
  const [currencyId, setCurrencyId] = useState(String(detail?.currencyId ?? ''));
  const [rate, setRate] = useState(trimDecimal(String(detail?.exchangeRate ?? '1')));
  const [manual, setManual] = useState(detail?.exchangeRateSource === 'MANUAL');
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [refreshRate, setRefreshRate] = useState(false);
  const [purpose, setPurpose] = useState(String(detail?.purpose ?? ''));
  const [approver, setApprover] = useState(String(detail?.draftApproverId ?? ''));
  const [receiver, setReceiver] = useState(String(detail?.draftReceiverId ?? ''));
  const [lines, setLines] = useState<PrLine[]>(() => (detail?.lines ?? []).map(fromSavedPrLine));
  const [selectedLines, setSelectedLines] = useState(new Set<string>());
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<{ lines: PrLine[]; strict: boolean; backendMessage?: string; fieldIssue?: ApiError['fieldIssue'] }>();
  const [tab, setTab] = useState('general');
  const [invalid, setInvalid] = useState('');
  const [deletingLine, setDeletingLine] = useState<{ key: string; position: number; code: string; name: string } | null>(null);
  const [discard, setDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [templateConflict, setTemplateConflict] = useState(false);
  const state = JSON.stringify([validDates, contract, route, category, purpose, approver, receiver, lines, name, requisitionDate, requiredDate, description, currencyId, rate, manual, currencyTouched, refreshRate]);
  const initial = useRef(state);
  const allowNavigation = useRef(false);
  const requestKey = useRef<{ payload: string; key: string } | undefined>(undefined);
  const submittedVersion = useRef(detail?.version);
  const submittedRound = useRef(detail?.approvalRound ?? 0);
  const dirty = state !== initial.current || dossier.dirty;
  const [selected, setSelected] = useState<ContractOption | null>(null);
  const [contractText, setContractText] = useState('');
  const [contractInput, setContractInput] = useState('');
  const contractQuery = useDebouncedText(contractText);
  const contracts = useQuery({ queryKey: ['pr-contracts', contractQuery], queryFn: ({ signal }) =>
    api<ContractOption[]>('/purchase-requisitions/catalog/contracts?' + new URLSearchParams({ q: contractQuery }), { signal }), enabled: !detail });
  const currencyOptions = useQuery({ queryKey: ['pr-currencies', detail?.currencyId], queryFn: () =>
    api<Currency[]>('/currencies?activeOnly=true' + (detail?.currencyId ? '&includeId=' + detail.currencyId : '')) });
  const currency = currencyOptions.data?.find(option => currencyId ? String(option.id) === currencyId : option.code === 'VND');
  const sameSavedCurrency = detail?.currencyId != null && String(detail.currencyId) === currencyId;
  const currencyCode = String((sameSavedCurrency ? detail.currencyCode : null) ?? currency?.code ?? 'VND');
  const scale = Number((sameSavedCurrency ? detail.currencyDecimalPlaces : null) ?? currency?.decimalPlaces ?? 0);
  const contractLines = useQuery({ queryKey: ['pr-contract-lines', contract], queryFn: () =>
    api<ContractLine[]>(`/sales-contracts/${contract}/lines`), enabled: Boolean(contract) });
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
        name, purpose, description, requisitionDate: requisitionDate || null, requiredDate: requiredDate || null,
        ...(currencyTouched && { currencyId: currency?.id, exchangeRateSource: manual ? 'MANUAL' : 'CATALOG',
          ...(manual && { exchangeRate: rate }), ...(refreshRate && { refreshCatalogExchangeRate: true }) }),
        ...(candidates.data && { approverId: Number(validApprover) || null, receiverId: Number(validReceiver) || null }),
        lines: lines.map(line => ({ id: line.id, productId: line.productId, temporaryProductId: line.temporaryProductId,
          salesContractLineId: line.salesContractLineId ?? null, requirementDescription: line.requirementDescription,
          brandId: line.brandId, supplierId: line.supplierId, unitOfMeasureId: line.unitOfMeasureId,
          quantity: line.quantity, unitPrice: line.unitPrice, taxRateId: line.taxRateId })),
        ...(dossier.payload && { dossier: dossier.payload }),
      };
      if (!detail) {
        const create = { ...payload, category, salesContractId: Number(contract), route: route || undefined, submit };
        const serialized = JSON.stringify(create);
        if (requestKey.current?.payload !== serialized) requestKey.current = { payload: serialized, key: crypto.randomUUID() };
        return api<{ id: number; documentNumber: string }>('/purchase-requisitions/save-new', {
          method: 'POST', body: JSON.stringify({ ...create, requestKey: requestKey.current.key }),
        });
      }
      await api(`/purchase-requisitions/${detail.id}${submit ? '/submit-edited' : ''}`, {
        method: 'PATCH', body: JSON.stringify({ ...payload, version: submittedVersion.current,
          ...(submit && { round: submittedRound.current, step: 'CREATE' }) }),
      });
      return { id: detail.id, documentNumber: detail.documentNumber };
    },
    onSuccess: (data, submit) => {
      initial.current = state;
      dossier.revert();
      allowNavigation.current = true;
      setConfirmation(false);
      onSaved(data.id, data.documentNumber, submit);
    },
    onError: (error, submit) => {
      setConfirmation(false);
      if (error instanceof ApiError) {
        if (error.code === 'PR_DOSSIER_TEMPLATE_CHANGED') {
          setTemplateConflict(true);
          setTab('dossier');
          return;
        }
        const candidateError = error.code === 'PR_CANDIDATE_NOT_ELIGIBLE';
        const lineError = Boolean(error.fieldIssue) || ['PR_LINE_INCOMPLETE','PR_INVALID_LINE','PR_INVALID_UNIT_PRICE','PR_INVALID_TAX_RATE','PR_SUPPLIER_NOT_LINKED',
          'SALES_CONTRACT_LINE_MISMATCH','SALES_CONTRACT_LINE_REQUIRED','PR_PRODUCT_DETAILS_MISMATCH','PR_TEMPORARY_PRODUCT_NOT_FOUND',
          'PRODUCT_NOT_FOUND','SUPPLIER_NOT_FOUND','BRAND_NOT_FOUND','UOM_NOT_FOUND','TAX_RATE_NOT_FOUND'].includes(error.code);
        const headerError = error.status === 400 || ['PR_HEADER_INCOMPLETE','PR_INVALID_CURRENCY','PR_INVALID_EXCHANGE_RATE',
          'PR_SALES_CONTRACT_REQUIRED','PR_ROUTE_REQUIRED'].includes(error.code);
        if (candidateError || lineError || headerError) {
          const target = candidateError ? 'approvers' : 'general';
          if (lineError) setEditing({ lines, strict: submit, backendMessage: error.message, fieldIssue: error.fieldIssue });
          setInvalid(target);
          setTab(target);
          if (candidateError) void candidates.refetch();
          return;
        }
      }
      onResult({ success: false, error, message: detail
        ? t(`pr.result.failure.${submit ? 'submit' : 'save'}`, { number: detail.documentNumber })
        : t(submit ? 'pr.createSubmitFailed' : 'pr.saveFailed') });
    },
  });
  const busy = save.isPending || dossier.pending;
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!allowNavigation.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  function validate(submit: boolean) {
    if (dossier.invalid || (!detail && !dossier.payload) || templateConflict) {
      setTab('dossier');
      setInvalid('dossier');
      return false;
    }
    setNameRequired(submit);
    const headerInvalid = !contract || !category || (dual && !route) || (submit && !name.trim())
      || validDates.includes(false) || (manual && (!decimalInput(rate, 8) || !positiveDecimal(rate)));
    const invalidLines = lines.filter(line => Object.keys(prLineErrors(line, submit, category === 'SALES_GOODS')).length);
    if (!headerInvalid && invalidLines.length) {
      setTab('general');
      setEditing({ lines, strict: submit });
      return false;
    }
    const field = !contract || !category ? 'general' : !lines.length ? 'lines' : headerInvalid ? 'general' :
      submit && (!validApprover || !validReceiver) ? 'approvers' : '';
    setInvalid(field);
    if (!field) return true;
    setTab(field === 'approvers' ? 'approvers' : 'general');
    requestAnimationFrame(() => document.getElementById(field === 'lines' ? 'pr-lines' : field === 'general'
      ? (!contract ? 'pr-contract' : !category ? 'pr-category' : dual && !route ? 'pr-route' : !name.trim() && submit ? 'pr-name' : !validDates[0] ? 'pr-requisitionDate' : !validDates[1] ? 'pr-requiredDate' : 'pr-rate') : !validApprover ? 'pr-approver' : 'pr-receiver')?.focus());
    return false;
  }
  function change(work: () => void) {
    allowNavigation.current = false;
    work();
  }
  function deleteRows(keys: ReadonlySet<string>) {
    change(() => {
      setLines(previous => previous.filter(line => !keys.has(line.key)));
      setSelectedLines(new Set());
    });
  }
  const lockHint = t('prPhase.locked');
  const locked = lines.length > 0;
  const dateField = (field: 'requisitionDate' | 'requiredDate', value: string, set: (value: string) => void, index: number) =>
    <DocumentDatePicker id={'pr-' + field} label={t(`prPhase.${field}`)} value={value} onChange={value => change(() => set(value))}
      onValidityChange={valid => { change(() => setValidDates(previous => previous.map((v, i) => i === index ? valid : v))); }} />;
  const general = <DocumentFormGrid compact>
    {invalid === 'general' && !editing && save.error instanceof ApiError && [400, 422].includes(save.error.status) && save.error.code !== 'PR_CANDIDATE_NOT_ELIGIBLE'
        && <DocumentFormCell><ErrorAlert error={save.error} /></DocumentFormCell>}
    <DocumentFormCell span={8}><TextField id="pr-name" label={t('prPhase.name')} value={name}
      error={nameRequired && !name.trim()} onChange={e => change(() => setName(e.target.value))} /></DocumentFormCell>
    <DocumentFormCell span={4}><PrReadonlyField label={t('pr.requester')} value={String(detail?.requesterName ?? detail?.createdByName ?? user.fullName ?? '')} /></DocumentFormCell>
    <DocumentFormCell span={3}>{detail ? <PrReadonlyField label={t('pr.category')} value={t(`category.${category}`)} /> :
      <Tooltip title={locked ? lockHint : ''}><span><TextField id="pr-category" select required disabled={locked} label={t('pr.category')}
        value={category} error={invalid === 'general' && !category} onChange={e => change(() => setCategory(e.target.value))}>
        <MenuItem value="">{t('pr.noSelection')}</MenuItem>
        {['SALES_GOODS', 'MATERIAL'].map(value => <MenuItem key={value} value={value}>{t(`category.${value}`)}</MenuItem>)}
      </TextField></span></Tooltip>}</DocumentFormCell>
    <DocumentFormCell span={5}>{detail ? <PrReadonlyField label={t('gir.salesContract')} value={[detail.salesContractNumber, detail.customerName].filter(Boolean).join(' · ')} /> :
      <Tooltip title={locked ? lockHint : ''}><span><Autocomplete id="pr-contract" disabled={locked} value={selected} inputValue={contractInput} clearText={t('common.clearSearch')}
        options={selected && !contracts.data?.some(item => item.id === selected.id) ? [selected, ...(contracts.data ?? [])] : contracts.data ?? []}
        isOptionEqualToValue={(a,b) => a.id === b.id} getOptionLabel={contractLabel}
        filterOptions={options => options} loading={contracts.isFetching || contractText !== contractQuery}
        onInputChange={(_, value, reason) => {
          setContractInput(value);
          if (reason === 'input' || reason === 'clear') setContractText(value);
        }}
        onChange={(_, value) => change(() => { setSelected(value); setContract(String(value?.id ?? '')); setContractText(''); setApprover(''); setReceiver(''); setRoute(''); })}
        renderInput={params => <SearchAutocompleteInput params={params} required label={t('gir.salesContract')} placeholder={t('searchFields.contract')}
          keyword={selected && contractInput === contractLabel(selected) ? '' : contractInput}
          onClear={() => { setContractInput(selected ? contractLabel(selected) : ''); setContractText(''); }}
          error={invalid === 'general' && !contract} />} /></span></Tooltip>}</DocumentFormCell>
    <DocumentFormCell span={2}>{dateField('requisitionDate', requisitionDate, setRequisitionDate, 0)}</DocumentFormCell>
    <DocumentFormCell span={2}>{dateField('requiredDate', requiredDate, setRequiredDate, 1)}</DocumentFormCell>
    <DocumentFormCell><Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Tooltip title={locked ? lockHint : ''}><span style={{ width: 168 }}><TextField size="small" select disabled={locked}
      label={t('prPhase.currency')} value={currency?.id ?? ''} onChange={e => change(() => {
        const chosen = currencyOptions.data?.find(item => item.id === Number(e.target.value));
        setCurrencyId(e.target.value); setManual(false); setRate(trimDecimal(chosen?.exchangeRate ?? '1')); setCurrencyTouched(true); setRefreshRate(false);
      })}>
      {!currencyOptions.data?.length && <MenuItem value="">{currencyCode}</MenuItem>}
      {currencyOptions.data?.map(item => <MenuItem value={item.id} key={item.id}>
        {sameSavedCurrency && item.id === detail.currencyId ? currencyCode : item.code}
      </MenuItem>)}
    </TextField></span></Tooltip>
    <FormControlLabel sx={{ m: 0, height: 36 }} control={<Checkbox checked={manual} disabled={currencyCode === 'VND'}
      onChange={e => change(() => { setManual(e.target.checked); setCurrencyTouched(true); setRefreshRate(!e.target.checked);
        if (!e.target.checked) setRate(trimDecimal(currency?.exchangeRate ?? '1')); })} />} label={t('prPhase.manual')} />
    <DocumentNumericInput id="pr-rate" sx={{ width: 180 }} label={t('prPhase.rate')} value={rate} precision={8} readOnly={!manual}
      error={manual && invalid === 'general' && (!decimalInput(rate, 8) || !positiveDecimal(rate))}
      onChange={value => change(() => { setRate(value); setCurrencyTouched(true); })} />
    </Stack></DocumentFormCell>
    <DocumentFormCell span={6}><TextField label={t('prPhase.purpose')} multiline minRows={2} value={purpose} onChange={e => change(() => setPurpose(e.target.value))} /></DocumentFormCell>
    <DocumentFormCell span={6}><TextField label={t('prPhase.description')} multiline minRows={2} value={description} onChange={e => change(() => setDescription(e.target.value))} /></DocumentFormCell>
    {dual && <DocumentFormCell span={3}><TextField id="pr-route" select required label={t('pr.route')} value={route} error={invalid === 'general' && !route}
      onChange={e => change(() => { setRoute(e.target.value); setApprover(''); setReceiver(''); })}>
      <MenuItem value="">{t('pr.noSelection')}</MenuItem><MenuItem value="SALES">Sales</MenuItem><MenuItem value="PM">PM</MenuItem>
    </TextField></DocumentFormCell>}
  </DocumentFormGrid>;
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
    {children({ general, assignmentNotice, tab, setTab, invalidTab: invalid, saving: save.isPending,
      templateConflict, onTemplateResolved: () => { setTemplateConflict(false); setInvalid(''); },
      approver: assignment('pr-approver', t('gr.approver'), validApprover, setApprover, candidates.data?.approvers),
      receiver: assignment('pr-receiver', t('pr.receiver'), validReceiver, setReceiver, candidates.data?.receivers),
      onBack: () => { if (busy) return; dirty ? setDiscard(true) : onBack(); },
      grid: <><PrLineTable lines={lines} scale={scale} currency={currencyCode}
        official={detail && !dirty ? [detail.subtotal, detail.taxTotal, detail.total].map(value =>
          value == null ? null : String(value)) as [string | null, string | null, string | null] : undefined}
        selected={selectedLines} onSelection={setSelectedLines}
        onEdit={save.isPending ? undefined : index => setEditing({ lines: [lines[index]], strict: false })}
        onDelete={save.isPending ? undefined : index => {
          const row = lines[index];
          setDeletingLine({ key: row.key, position: index + 1, code: row.partNumber, name: row.productName });
        }}
        toolbar={<Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end', py: 0.5 }}>
          <Typography sx={{ flexGrow: 1, fontWeight: 700 }} color={invalid === 'lines' ? 'error' : undefined}>{t('prPhase.lines')}</Typography>
          <BulkDeleteRows selected={selectedLines} disabled={save.isPending} onDelete={deleteRows} />
          <ActionButton action="edit" variant="outlined" disabled={!selectedLines.size || save.isPending}
            onClick={() => setEditing({ lines: lines.filter(line => selectedLines.has(line.key)), strict: false })}>
            {t('pr.editGoods')} ({selectedLines.size})
          </ActionButton>
          <Tooltip title={!contract || !category ? t('prPhase.chooseHeader') : ''}><span><ActionButton action="add"
            disabled={!contract || !category || (dual && !route) || save.isPending || contractLines.isFetching} onClick={() => setPicker(true)}>{t('pr.addGoods')}</ActionButton></span></Tooltip>
        </Stack>} />{invalid === 'lines' && <Typography role="alert" color="error">{t('prPhase.needsLine')}</Typography>}</>,
      footer: <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <ActionButton action="save" variant="outlined" disabled={busy} onClick={() => { if (validate(false)) save.mutate(false); }}>{t('pr.saveDraft')}</ActionButton>
        <ActionButton action="submit" disabled={busy} onClick={() => { if (validate(true)) setConfirmation(true); }}>{t('doc.submit')}</ActionButton>
      </Stack>,
    })}
    {router && <RouteDiscardGuard dirty={dirty} pending={busy} allowNavigation={() => allowNavigation.current} />}
    {discard && <DiscardDialog onKeep={() => setDiscard(false)} onDiscard={() => { allowNavigation.current = true; onBack(); }} />}
    {confirmation && <FormDialog title={t('doc.confirmAction', { action: t('doc.submit') })} submitLabel={t('doc.submit')}
      submitAction="submit" pageGuardsNavigation canSubmit={!dossier.pending} pending={save.isPending} error={null} onClose={() => setConfirmation(false)} onSubmit={() => save.mutate(true)}>
      {t('pr.title')} {detail?.documentNumber} · {t('pr.confirmEffect.submit')}
    </FormDialog>}
    {picker && <ProductPicker onClose={() => setPicker(false)} onConfirm={items => {
      setPicker(false);
      setEditing({ lines: items.map(item => fromPickedProduct(item, contractLines.data ?? [])), strict: false });
    }} />}
    {editing && <PrLineEditor initial={editing.lines} strict={editing.strict} salesGoods={category === 'SALES_GOODS'}
      backendMessage={editing.backendMessage} fieldIssue={editing.fieldIssue} contract={contract} route={route || String(detail?.creatorRoute ?? '')}
      contractLines={contractLines.data ?? []} scale={scale} currency={currencyCode}
      onClose={() => setEditing(undefined)} onConfirm={updated => change(() => {
        const initialKeys = new Set(editing.lines.map(line => line.key));
        const changed = new Map(updated.map(line => [line.key, line]));
        setLines(previous => [...previous.flatMap(line => {
          const next = changed.get(line.key);
          return next ? [next] : initialKeys.has(line.key) ? [] : [line];
        }), ...updated.filter(line => !lines.some(existing => existing.key === line.key))]);
        setSelectedLines(new Set());
        setInvalid('');
        setEditing(undefined);
      })} />}
    {deletingLine !== null && <FormDialog title={t('pr.deleteGoods')} submitLabel={t('pr.deleteGoods')} submitAction="delete"
      canSubmit pending={false} error={null} onClose={() => setDeletingLine(null)}
      onSubmit={() => { deleteRows(new Set([deletingLine.key])); setDeletingLine(null); }}>
      {t('pr.deleteGoodsConfirm', { row: deletingLine.position, code: deletingLine.code, name: deletingLine.name })}
    </FormDialog>}
  </>;
}
