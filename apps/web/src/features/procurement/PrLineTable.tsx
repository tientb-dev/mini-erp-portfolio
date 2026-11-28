import { Fragment, ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Checkbox, Chip, Dialog, DialogActions, DialogContent, IconButton, MenuItem, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import Delete from '@mui/icons-material/DeleteOutlined';
import Edit from '@mui/icons-material/EditOutlined';
import Warning from '@mui/icons-material/WarningAmberRounded';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api-client';
import { ErrorAlert, FormDialog, GridText, ScrollTable } from '../../shared/components';
import { ActionButton } from '../../shared/components/ActionButton';
import { DialogHeading } from '../../shared/components/DialogHeading';
import { DocumentTotals } from '../../shared/components/DocumentTotals';
import { DocumentNumericInput, displayDocumentNumber } from '../../shared/components/DocumentNumericInput';
import { ValidationMessage, ValidationTooltip } from '../../shared/components/DocumentValidation';
import { ProductPicker } from '../../shared/components/ProductPicker';
import { decimalFromMinor, formatDocumentAmount, previewDocumentLine } from '../../shared/utils/document-money';
import { trimDecimal } from '../../shared/utils/format';
import { ContractLine, PrLine, fromPickedProduct, prLineErrors } from './pr-lines';

type Choice = { id: number; name: string; code?: string; rate?: string };
type Field = keyof PrLine;
type RowErrors = ReturnType<typeof prLineErrors>;
const widths = [48, 105, 154, 200, 205, 145, 180, 108, 115, 135, 140, 115, 140, 150, 265];

export function PrLineTable({ lines, scale = 0, currency = 'VND', official, selected, onSelection, onEdit, onDelete, toolbar, inputs }: {
  lines: PrLine[]; scale?: number; currency?: string; official?: [string | null, string | null, string | null];
  selected?: Set<string>; onSelection?: (keys: Set<string>) => void; onEdit?: (index: number) => void;
  onDelete?: (index: number) => void; toolbar?: ReactNode;
  inputs?: (line: PrLine, field: Field, fallback: string) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const editable = Boolean(onEdit || onDelete);
  const labels = ['row','source','itemCode','itemName','requirement','brand','supplier','uom','quantity','unitPrice','lineNet','taxRate','tax','total','mapping'];
  const numeric = new Set([8, 9, 10, 11, 12, 13]);
  const previews = lines.map(l => previewDocumentLine(l.quantity, l.unitPrice, l.taxRate, scale));
  function sum(key: 'net' | 'tax' | 'total') {
    let amount = BigInt(0);
    for (const line of previews) {
      const value = line?.[key];
      if (value == null) return null;
      amount += value;
    }
    return decimalFromMinor(amount, scale);
  }
  const amounts = official ?? [sum('net'), sum('tax'), sum('total')];
  const firstLeft = onSelection ? 46 : 0;
  const field = (line: PrLine, key: Field, fallback: string) => inputs?.(line, key, fallback) ?? <GridText value={fallback || '—'} />;
  const money = (value: unknown) => formatDocumentAmount(value, scale, i18n.language);

  return <Stack id="pr-lines" tabIndex={-1} spacing={0.5} sx={{ minWidth: 0, px: inputs ? 0 : 2 }}>
    {toolbar ?? (!inputs && <Typography sx={{ fontWeight: 700, py: 0.5 }}>{t('prPhase.lines')}</Typography>)}
    <ScrollTable label={t('prPhase.lines')} maxHeight={inputs ? 'min(55dvh, 600px)' : 'clamp(118px, 35dvh, 440px)'}
      stickyLeftWidth={firstLeft + widths[0] + widths[1] + widths[2]}
      columnWidths={[...(onSelection ? [46] : []), ...widths, ...(editable ? [95] : [])]}>
      <TableHead><TableRow>
        {onSelection && <TableCell data-grid-left style={{ left: 0 }}>
          <Checkbox size="small" checked={!!lines.length && selected?.size === lines.length}
            indeterminate={Boolean(selected?.size && selected.size < lines.length)}
            slotProps={{ input: { 'aria-label': t('prPhase.selectPage') } }}
            onChange={e => onSelection(new Set(e.target.checked ? lines.map(l => l.key) : []))} />
        </TableCell>}
        {labels.map((label, i) => <TableCell key={label} data-grid-left={i < 3 ? '' : undefined}
          style={i < 3 ? { left: firstLeft + widths.slice(0, i).reduce((a,b) => a + b, 0) } : undefined}
          align={numeric.has(i) ? 'right' : 'left'}>{t(`prPhase.${label}`)}</TableCell>)}
        {editable && <TableCell data-grid-actions>{t('prPhase.actions')}</TableCell>}
      </TableRow></TableHead>
      <TableBody>
        {!lines.length && <TableRow><TableCell colSpan={labels.length + Number(Boolean(onSelection)) + Number(editable)}>{t('prPhase.emptyLines')}</TableCell></TableRow>}
        {lines.map((line, index) => {
          const duplicates = lines.flatMap((other, i) => i !== index && other.partNumber.trim().toLowerCase() === line.partNumber.trim().toLowerCase() ? [i + 1] : []);
          const preview = previews[index];
          const derived = (key: 'net' | 'tax' | 'total', snapshot?: string | null) => {
            const value = preview?.[key];
            return money(official ? snapshot : value == null ? null : decimalFromMinor(value, scale));
          };
          return <TableRow key={line.key} selected={selected?.has(line.key)}>
            {onSelection && <TableCell data-grid-left style={{ left: 0 }}><Checkbox size="small" checked={selected?.has(line.key) ?? false}
              slotProps={{ input: { 'aria-label': t('prPhase.row') + ' ' + (index + 1) } }}
              onChange={e => { const keys = new Set(selected); e.target.checked ? keys.add(line.key) : keys.delete(line.key); onSelection(keys); }} /></TableCell>}
            <TableCell data-grid-left style={{ left: firstLeft }}>{index + 1}</TableCell>
            <TableCell data-grid-left style={{ left: firstLeft + widths[0] }}><Chip size="small" variant="outlined" color={line.temporaryProductId ? 'secondary' : 'primary'}
              label={t(line.temporaryProductId ? 'prPhase.temporary' : 'prPhase.main')} /></TableCell>
            <TableCell data-grid-left style={{ left: firstLeft + widths[0] + widths[1] }}><GridText value={line.partNumber}
              trailing={duplicates.length > 0 && <Tooltip title={t('prPhase.duplicates', { rows: duplicates.join(', ') })}>
                <Box component="span" tabIndex={0} sx={{ display: 'flex', ml: 0.5 }}><Warning fontSize="small" color="warning" /></Box>
              </Tooltip>} /></TableCell>
            <TableCell><GridText value={line.productName} /></TableCell>
            <TableCell>{field(line, 'requirementDescription', line.requirementDescription)}</TableCell>
            <TableCell>{field(line, 'brandId', line.brandName ?? '')}</TableCell>
            <TableCell>{field(line, 'supplierId', line.supplierName ?? '')}</TableCell>
            <TableCell>{field(line, 'unitOfMeasureId', line.uom)}</TableCell>
            <TableCell align="right">{field(line, 'quantity', displayDocumentNumber(line.quantity, i18n.language, 3, true))}</TableCell>
            <TableCell align="right">{field(line, 'unitPrice', displayDocumentNumber(line.unitPrice, i18n.language, 4, true))}</TableCell>
            <TableCell align="right"><GridText value={derived('net', line.subtotal)} /></TableCell>
            <TableCell align="right">{field(line, 'taxRateId', line.taxRate ? trimDecimal(line.taxRate) + '%' : '')}</TableCell>
            <TableCell align="right"><GridText value={derived('tax', line.taxAmount)} /></TableCell>
            <TableCell align="right"><GridText value={derived('total', line.total)} /></TableCell>
            <TableCell>{field(line, 'salesContractLineId', line.ref)}</TableCell>
            {editable && <TableCell data-grid-actions><Stack direction="row">
              {onEdit && <Tooltip title={t('pr.editGoods')}><IconButton size="small" aria-label={t('pr.editGoods')} onClick={() => onEdit(index)}><Edit fontSize="small" /></IconButton></Tooltip>}
              {onDelete && <Tooltip title={t('pr.deleteGoods')}><IconButton size="small" color="error" aria-label={t('pr.deleteGoodsAt', { row: index + 1 })} onClick={() => onDelete(index)}><Delete fontSize="small" /></IconButton></Tooltip>}
            </Stack></TableCell>}
          </TableRow>;
        })}
      </TableBody>
    </ScrollTable>
    <DocumentTotals count={lines.length} currency={currency} scale={scale} values={amounts} />
  </Stack>;
}

export function PrLineEditor({ initial, contract, route, prId, contractLines, currency, scale, strict, salesGoods, backendMessage, fieldIssue, onClose, onConfirm }: {
  initial: PrLine[]; contract: string; route: string; contractLines: ContractLine[]; currency: string; scale: number;
  prId?: number; strict: boolean; salesGoods: boolean; backendMessage?: string; fieldIssue?: { index: number; field: string }; onClose: () => void; onConfirm: (lines: PrLine[]) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [lines, setLines] = useState(initial);
  const [validated, setValidated] = useState(strict || Boolean(fieldIssue));
  const [focusRequest, requestFocus] = useState(strict || fieldIssue ? 1 : 0);
  const [serverIssue, setServerIssue] = useState(fieldIssue);
  const [picker, setPicker] = useState(false);
  const [remove, setRemove] = useState<string>();
  const grid = useRef<HTMLDivElement>(null);
  const brands = useQuery({ queryKey: ['brands','pr-active'], queryFn: () => api<Choice[]>('/brands?activeOnly=true') });
  const units = useQuery({ queryKey: ['uom','pr-active'], queryFn: () => api<Choice[]>('/units-of-measure?activeOnly=true') });
  const taxes = useQuery({ queryKey: ['tax','pr-active'], queryFn: () => api<Choice[]>('/tax-rates?activeOnly=true') });
  const brandIds = [...new Set(lines.flatMap(line => line.brandId ? [line.brandId] : []))];
  const supplierQuery = (id: number) => ({
    queryKey: ['pr-suppliers', contract, route, prId, id], enabled: Boolean(contract || prId), queryFn: () => api<Choice[]>(
      contract
        ? `/purchase-requisitions/catalog/suppliers?salesContractId=${contract}&brandId=${id}${route ? '&route=' + route : ''}`
        : `/purchase-requisitions/${prId}/catalog/suppliers?brandId=${id}`),
  });
  const suppliers = useQueries({ queries: brandIds.map(supplierQuery) });
  const errors = new Map(lines.map(line => [line.key, validated ? prLineErrors(line, strict, salesGoods, !contract) : {}]));
  const serverLine = serverIssue && initial[serverIssue.index];
  if (serverLine && serverIssue) (errors.get(serverLine.key) as RowErrors)[serverIssue.field as Field] = 'server';
  const count = [...errors.values()].reduce((sum, values) => sum + Object.keys(values).length, 0);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const control = grid.current?.querySelector<HTMLElement>('[data-pr-invalid] input, [data-pr-invalid] [role=combobox]');
    control?.scrollIntoView?.({ block: 'center', inline: 'center' });
    control?.focus({ preventScroll: true });
  }, [focusRequest]);
  function patch(line: PrLine, update: Partial<PrLine>) {
    if (serverLine?.key === line.key && serverIssue && Object.hasOwn(update, serverIssue.field)) setServerIssue(undefined);
    setLines(previous => previous.map(item => item.key === line.key ? { ...item, ...update } : item));
  }
  function changeBrand(line: PrLine, brand?: Choice) {
    patch(line, { brandId: brand?.id ?? null, brandName: brand?.name, supplierId: null, supplierName: undefined });
    if (!brand || !line.supplierId) return;
    void qc.fetchQuery(supplierQuery(brand.id)).then(options => {
      const supplier = options.find(choice => choice.id === line.supplierId);
      if (!supplier) return;
      setLines(previous => previous.map(item => item.key === line.key && item.brandId === brand.id && !item.supplierId
        ? { ...item, supplierId: supplier.id, supplierName: supplier.name } : item));
    }, () => undefined);
  }
  function control(line: PrLine, key: Field, fallback: string) {
    const error = (errors.get(line.key) as RowErrors)?.[key];
    const common = { fullWidth: true, size: 'small' as const, error: Boolean(error),
      sx: { '& .MuiInputBase-root': { height: 36 }, '& .MuiSelect-select': { overflow: 'hidden', textOverflow: 'ellipsis' } } };
    function select(value: number | null | undefined, choices: Choice[], onSelect: (choice?: Choice) => void, disabled = false, selectedLabel?: string) {
      const options = value && !choices.some(item => item.id === value) ? [{ id: value, name: fallback }, ...choices] : choices;
      return <TextField {...common} select disabled={disabled} value={value ?? ''} onChange={e => onSelect(options.find(c => c.id === Number(e.target.value)))}
        slotProps={{ select: { ...(selectedLabel && { renderValue: () => selectedLabel }), MenuProps: { slotProps: { paper: { sx: { maxWidth: '75vw' } } } }, inputProps: { 'aria-label': t(`prPhase.${key}`) } } }}>
        <MenuItem value="">{t('pr.noSelection')}</MenuItem>
        {options.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
      </TextField>;
    }
    let input: ReactNode;
    switch (key) {
      case 'requirementDescription':
        input = <TextField {...common} value={line[key]} onChange={e => patch(line, { [key]: e.target.value })}
          slotProps={{ htmlInput: { 'aria-label': t('prPhase.requirement') } }} />;
        break;
      case 'quantity': case 'unitPrice':
        input = <DocumentNumericInput error={common.error} sx={common.sx} precision={key === 'quantity' ? 3 : 4}
          value={line[key]} inputLabel={t(`prPhase.${key}`)} alignRight onChange={value => patch(line, { [key]: value })} />;
        break;
      case 'brandId':
        if (!line.temporaryProductId) return <GridText value={fallback} />;
        input = select(line.brandId, brands.data ?? [], b => changeBrand(line, b));
        break;
      case 'supplierId':
        input = select(line.supplierId, suppliers[brandIds.indexOf(line.brandId ?? 0)]?.data ?? [],
          s => patch(line, { supplierId: s?.id ?? null, supplierName: s?.name }), !line.brandId);
        break;
      case 'unitOfMeasureId':
        if (!line.temporaryProductId) return <GridText value={fallback} />;
        input = select(line.unitOfMeasureId, units.data ?? [], u => patch(line, { unitOfMeasureId: u?.id ?? null, uom: u?.code ?? '' }));
        break;
      case 'taxRateId':
        input = select(line.taxRateId, (taxes.data ?? []).map(x => ({
          ...x, name: (x.id === line.taxRateId ? line.taxRate : trimDecimal(x.rate ?? '')) + '% · ' + x.name,
        })),
          tax => patch(line, { taxRateId: tax?.id ?? null, taxRate: trimDecimal(tax?.rate ?? '') }), false, line.taxRateId ? trimDecimal(line.taxRate) + '%' : undefined);
        break;
      case 'salesContractLineId':
        input = select(line.salesContractLineId, contractLines.map((c, i) => ({ id: c.id, name: `${i + 1} · ${c.itemCode} · ${c.itemName}${c.itemDescription ? ' · ' + c.itemDescription : ''} · ${trimDecimal(c.quantity ?? '')}` })),
          c => patch(line, { salesContractLineId: c?.id ?? null, ref: c?.name ?? '' }), !contract);
        break;
      default: return undefined;
    }
    return <ValidationTooltip title={error === 'server' ? backendMessage : error ? t(`prPhase.${error}`) : ''}>
      <Box data-pr-invalid={error ? '' : undefined}>{input}</Box>
    </ValidationTooltip>;
  }
  function confirm() {
    setValidated(true);
    if (!lines.length || serverIssue || lines.some(line => Object.keys(prLineErrors(line, strict, salesGoods, !contract)).length)) {
      requestFocus(previous => previous + 1);
      return;
    }
    onConfirm(lines);
  }
  const fetchError = brands.error ?? units.error ?? taxes.error ?? suppliers.find(q => q.error)?.error;
  return <Fragment>
    <Dialog open onClose={onClose} aria-labelledby="pr-line-editor-heading" maxWidth={false} slotProps={{ paper: { sx: { width: '98vw', maxWidth: '98vw', m: 1 } } }}>
      <DialogHeading id="pr-line-editor-heading" onClose={onClose}>{t('prPhase.editor')}</DialogHeading>
      <DialogContent data-compact="" ref={grid}>
        <Stack spacing={1}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontWeight: 700 }}>{t('prPhase.lines')}</Typography>
            <ActionButton action="add" onClick={() => setPicker(true)}>{t('pr.addGoods')}</ActionButton>
          </Stack>
          <ValidationMessage warning={Boolean(count || backendMessage)}>
            {count ? <GridText value={t('prPhase.errorCount', { count })} /> : backendMessage && <GridText value={backendMessage} />}
          </ValidationMessage>
          {fetchError && <ErrorAlert error={fetchError} />}
          <PrLineTable lines={lines} scale={scale} currency={currency} inputs={control}
            onDelete={index => setRemove(lines[index].key)} />
        </Stack>
      </DialogContent>
      <DialogActions><ActionButton action="cancel" onClick={onClose}>{t('common.cancel')}</ActionButton>
        <ActionButton action="confirm" disabled={!lines.length} onClick={confirm}>{t('prPhase.confirm')}</ActionButton></DialogActions>
    </Dialog>
    {remove && <FormDialog title={t('pr.deleteGoods')} submitLabel={t('pr.deleteGoods')} submitAction="delete" canSubmit
      pending={false} error={null} onClose={() => setRemove(undefined)}
      onSubmit={() => { setLines(previous => previous.filter(l => l.key !== remove)); if (serverLine?.key === remove) setServerIssue(undefined); setRemove(undefined); }}>
      {lines.find(line => line.key === remove)?.partNumber}
    </FormDialog>}
    {picker && <ProductPicker onClose={() => setPicker(false)} onConfirm={items => {
      setLines(previous => [...previous, ...items.map(item => fromPickedProduct(item, contractLines))]); setPicker(false);
    }} />}
  </Fragment>;
}
