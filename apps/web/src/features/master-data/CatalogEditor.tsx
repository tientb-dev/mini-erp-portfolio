import { useContext, useEffect, useId, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconButton, MenuItem, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import LinkOff from '@mui/icons-material/LinkOff';
import { api, ApiError } from '../../services/api-client';
import { DetailPageLayout, ErrorAlert, FormDialog, GridText, PageBreadcrumbs, ScrollTable } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { DiscardDialog, RouteDiscardGuard } from '../../shared/components/FormDialog';
import { trimDecimal } from '../../shared/utils/format';
import { ActionButton } from '../../shared/components/ActionButton';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { StatusChip } from '../../shared/components/StatusChip';
import { SupplierPicker } from './SupplierPicker';
import { Catalog, displayDecimal, Entry, entryCode, FieldKey, label, statusLabel } from './catalogs';

type Options = { data?: Entry[]; error: Error | null };
const booleans = new Set<FieldKey>(['isSerialTracked', 'allowAvailableStockIssue']);
const integers = new Set<FieldKey>(['brandId', 'unitOfMeasureId', 'decimalPlaces']);
const defaults: Partial<Record<FieldKey, string>> = { isSerialTracked: 'true', allowAvailableStockIssue: 'false', decimalPlaces: '0', rate: '0' };

export function CatalogEditor({ catalog, entry, copySource, initiallyEditing, close, report, showingResult, permissions, brands, uoms }: {
  catalog: Catalog; entry?: Entry; copySource?: Entry; initiallyEditing?: boolean; close: (result?: ActionResult) => void;
  report: (result: ActionResult) => void; showingResult: boolean; permissions: string[]; brands: Options; uoms: Options;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const router = useContext(UNSAFE_DataRouterContext);
  const [editing, setEditing] = useState(!entry || Boolean(initiallyEditing));
  const [discard, setDiscard] = useState(false);
  const [fields, setFields] = useState<Partial<Record<FieldKey, string>>>({});
  const [picker, setPicker] = useState(false);
  const [changedSuppliers, setChangedSuppliers] = useState<Entry[]>();
  const formId = useId();
  const allowNavigation = useRef(false);
  const path = `/${catalog.path}${entry ? `/${entry.id}` : ''}`;
  const canEdit = permissions.includes(catalog.update);
  const showSupplierLinks = catalog.key === 'brands';
  const canViewSuppliers = showSupplierLinks && permissions.includes('SUPPLIER.VIEW');
  const linked = useQuery({ queryKey: [path + '/suppliers'], queryFn: () => api<Entry[]>(path + '/suppliers'), enabled: canViewSuppliers && Boolean(entry) });
  const linkedIds = linked.data?.map(item => item.id) ?? [];
  const shownSuppliers = changedSuppliers ?? linked.data ?? [];
  const initial = (field: FieldKey) => {
    const value = copySource && (field === 'code' || field === 'partNumber') ? undefined : (entry ?? copySource)?.[field];
    if (typeof value === 'string' && (field === 'exchangeRate' || field === 'rate')) return trimDecimal(value);
    return value === undefined || value === null ? defaults[field] ?? '' : String(value);
  };
  const value = (field: FieldKey) => fields[field] ?? initial(field);
  const dirty = editing && (catalog.fields.some(field => value(field) !== initial(field)) ||
    (changedSuppliers !== undefined && changedSuppliers.map(item => item.id).sort().join() !== [...linkedIds].sort().join()));
  const vnd = catalog.key === 'currencies' && value('code') === 'VND';
  const resultFor = (action: string, success: boolean, error?: unknown): ActionResult => ({
    ...(success ? { success: true as const } : { success: false as const, error }),
    title: t(success ? 'master.resultSuccess' : 'master.resultFailure', { action }),
    message: t('master.resultTarget', { name: value('name'), code: value(catalog.key === 'products' ? 'partNumber' : 'code') }),
  });
  const inlineField = (error: unknown) => error instanceof ApiError
    ? (({ INVALID_EXCHANGE_RATE: 'exchangeRate', INVALID_TAX_RATE: 'rate', PRODUCT_UOM_LOCKED: 'unitOfMeasureId',
        PRODUCT_IDENTITY_LOCKED: 'partNumber', SERIAL_TRACKING_LOCKED: 'isSerialTracked', INVALID_DOSSIER_CODE: 'code',
        DUPLICATE_VALUE: catalog.key === 'products' ? 'partNumber' : 'code' }) as Record<string, FieldKey>)[error.code]
    : undefined;
  const saveAction = t(entry ? 'doc.saveEdit' : 'master.addAction');
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(catalog.fields.map(field => {
        const raw = value(field).trim();
        return [field, field === 'exchangeRate' && vnd ? '1' : booleans.has(field) ? raw === 'true' : integers.has(field) ? Number(raw) : raw];
      }));
      return api(path, { method: entry ? 'PATCH' : 'POST', body: JSON.stringify({
        ...body, ...(changedSuppliers && { supplierIds: changedSuppliers.map(item => item.id) }),
      }) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [catalog.key === 'unitsOfMeasure' ? 'uoms' : catalog.path] });
      if (showSupplierLinks) await qc.invalidateQueries({ queryKey: [path + '/suppliers'] });
      const result = resultFor(saveAction, true);
      if (entry && !initiallyEditing) { resetEditor(); report(result); }
      else { allowNavigation.current = true; close(result); }
    },
    onError: error => { if (!inlineField(error)) report(resultFor(saveAction, false, error)); },
  });
  const pending = save.isPending;
  useEffect(() => {
    if (!catalog.fullPage || (!dirty && !pending)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [catalog.fullPage, dirty, pending]);
  const resetEditor = () => {
    setEditing(false);
    setFields({});
    setPicker(false);
    setChangedSuppliers(undefined);
    setDiscard(false);
    save.reset();
  };
  const cancel = () => {
    if (entry && editing && !initiallyEditing) resetEditor();
    else { allowNavigation.current = true; close(); }
  };
  const title = t(`nav.${catalog.key}`);
  const editorTitle = t(editing ? entry ? 'master.edit' : 'master.create' : 'master.view',
    { name: title.toLocaleLowerCase(i18n.language) });
  const fieldErrors: Partial<Record<FieldKey, string>> = {};
  for (const field of catalog.fields) {
    const raw = value(field).trim();
    if (field !== 'description' && !raw && !(field === 'exchangeRate' && vnd)) fieldErrors[field] = t('master.required');
    if (raw && field === 'code' && catalog.key === 'currencies' && !/^[A-Z]{3}$/.test(raw)) fieldErrors[field] = t('master.currencyCode');
    if (field === 'exchangeRate' && !vnd && raw && (!/^\d{1,12}(\.\d{1,8})?$/.test(raw) || Number(raw) === 0)) fieldErrors[field] = t('master.invalidRate');
    if (field === 'decimalPlaces' && raw && !/^[0-8]$/.test(raw)) fieldErrors[field] = t('master.invalidPlaces');
    if (field === 'rate' && raw && (!/^\d{1,3}(\.\d{1,2})?$/.test(raw) || Number(raw) > 100)) fieldErrors[field] = t('master.invalidTax');
    const reference = field === 'brandId' ? brands.data : field === 'unitOfMeasureId' ? uoms.data : undefined;
    if ((field === 'brandId' || field === 'unitOfMeasureId') && raw &&
      !reference?.some(item => String(item.id) === raw)) fieldErrors[field] = t('master.required');
    const maxLength = field === 'partNumber' ? 100 : field === 'code' ? catalog.key === 'unitsOfMeasure' ? 20 : catalog.key === 'temporaryProducts' ? 100 : 50
      : field === 'name' ? catalog.key === 'unitsOfMeasure' ? 100 : catalog.key === 'warehouses' ? 200 : 300 : undefined;
    if (maxLength && raw.length > maxLength) fieldErrors[field] = t('master.tooLong', { count: maxLength });
  }
  const submitReady = Object.keys(fieldErrors).length === 0;
  const apiField = inlineField(save.error);
  const renderField = (field: FieldKey, span: 4 | 8 | 12) => {
    const raw = value(field);
    const options = field === 'brandId' ? brands.data : field === 'unitOfMeasureId' ? uoms.data : undefined;
    const select = Boolean(options) || integers.has(field) && field !== 'decimalPlaces' || booleans.has(field);
    const locked = !editing || (catalog.key === 'products' && entry?.isUsed && ['name', 'partNumber', 'unitOfMeasureId'].includes(field))
      || (field === 'isSerialTracked' && entry?.isStockUsed) || (field === 'exchangeRate' && vnd)
      || (field === 'code' && entry?.code === 'VND' && catalog.key === 'currencies');
    const issue = editing ? (apiField === field ? save.error?.message : raw !== '' || fields[field] !== undefined ? fieldErrors[field] : undefined) : undefined;
    const fixed = field === 'exchangeRate' && vnd ? '1' : raw;
    const shown = !editing && (field === 'exchangeRate' || field === 'rate') && fixed ? displayDecimal(fixed, i18n.language) : fixed;
    const fieldLabel = catalog.key === 'dossierTypes' && (field === 'code' || field === 'name')
      ? t(field === 'code' ? 'dossier.typeCode' : 'dossier.typeName') : label(t, field);
    const readValue = booleans.has(field) ? t(raw === 'true' ? 'common.yes' : 'common.no')
      : options ? options.find(item => String(item.id) === shown)?.name ?? '' : shown;
    return (
      <DocumentFormCell key={field} span={span}>
        {!editing ? <ReadOnlyField label={fieldLabel} value={readValue} multiline={field === 'description'}
          minRows={field === 'description' ? 2 : undefined} /> : <TextField fullWidth size="small" label={fieldLabel}
          value={select && !booleans.has(field) && !options?.some(item => String(item.id) === shown) ? '' : shown}
          disabled={pending || Boolean(select && (locked || integers.has(field) && !options))}
          slotProps={{ input: select ? undefined : { readOnly: Boolean(locked) }, htmlInput: { inputMode: field === 'decimalPlaces' ? 'numeric' : ['rate', 'exchangeRate'].includes(field) ? 'decimal' : undefined } }}
          select={select} required={editing && field !== 'description'} multiline={field === 'description'} minRows={field === 'description' ? 2 : undefined}
          error={Boolean(issue)} helperText={issue} onChange={event => {
            const raw = event.target.value;
            setFields({ ...fields, [field]: field === 'rate' || field === 'exchangeRate' ? raw.replace(',', '.') : raw }); save.reset();
          }}>
          {select && (booleans.has(field)
            ? ['true', 'false'].map(flag => <MenuItem key={flag} value={flag}>{t(flag === 'true' ? 'common.yes' : 'common.no')}</MenuItem>)
            : (options ?? []).map(item => <MenuItem key={item.id} value={String(item.id)}>{item.code} · {item.name}</MenuItem>))}
        </TextField>}
      </DocumentFormCell>
    );
  };
  const canLink = editing && canViewSuppliers;
  const supplierTable = showSupplierLinks && (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h2">{t('master.linkedSuppliers')}</Typography>
        {canLink && <ActionButton action="add" onClick={() => setPicker(true)}
          disabled={pending || Boolean(entry && !linked.isSuccess)}>{t('master.addSupplier')}</ActionButton>}
      </Stack>
      <ErrorAlert error={linked.error} />
      <ScrollTable label={t('master.linkedSuppliers')} columnWidths={[60, 140, 235, ...(canLink ? [96] : [])]} maxHeight="330px">
        <TableHead><TableRow><TableCell>{t('prPhase.row')}</TableCell><TableCell>{t('master.supplierCode')}</TableCell>
          <TableCell>{t('master.supplierName')}</TableCell>
          {canLink && <TableCell align="right" data-grid-actions>{t('common.actions')}</TableCell>}
        </TableRow></TableHead>
        <TableBody>{shownSuppliers.map((item, index) => <TableRow key={item.id}>
          <TableCell>{index + 1}</TableCell>
          <TableCell><GridText value={item.code ?? ''} /></TableCell>
          <TableCell><GridText value={item.name} /></TableCell>
          {canLink && <TableCell align="right" data-grid-actions><Tooltip title={t('master.unlinkSupplier')}>
            <IconButton aria-label={t('master.unlinkSupplier') + ' ' + item.code} color="error" size="small" disabled={pending}
              onClick={() => setChangedSuppliers(shownSuppliers.filter(supplier => supplier.id !== item.id))}><LinkOff fontSize="small" /></IconButton>
          </Tooltip></TableCell>}
        </TableRow>)}</TableBody>
      </ScrollTable>
      <Typography variant="body2">{t('master.supplierCount', { count: shownSuppliers.length })}</Typography>
    </Stack>
  );
  const fieldsContent = <DocumentFormGrid>
    {catalog.fields.map(field => renderField(field, field === 'description' ? 12 : field === 'name' ? 8 : 4))}
    <DocumentFormCell span={4}>
      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="caption">{t('common.status')}</Typography>
        <StatusChip label={statusLabel(t, entry?.isActive ?? true)} tone={(entry?.isActive ?? true) ? 'success' : 'muted'} />
      </Stack>
    </DocumentFormCell>
  </DocumentFormGrid>;
  const error = brands.error ?? uoms.error;
  const action = editing ? t(entry ? 'doc.saveEdit' : 'prCatalog.save') : canEdit ? t('master.editAction') : undefined;
  const submit = () => { if (editing) save.mutate(); else if (canEdit) setEditing(true); };
  const guard = router && <RouteDiscardGuard dirty={dirty} pending={pending} allowNavigation={() => allowNavigation.current} />;
  if (!catalog.fullPage) return <>
    {!showingResult && <FormDialog pageGuardsNavigation title={editorTitle} submitLabel={action}
      submitAction={editing ? 'save' : 'edit'} closeLabel={!editing ? t('common.close') : undefined}
      error={error} pending={pending} canSubmit={!editing || submitReady} onSubmit={submit} onClose={cancel} dirty={dirty}>
      {fieldsContent}
    </FormDialog>}
    {guard}
  </>;

  const maybeCancel = () => { if (!pending) dirty ? setDiscard(true) : cancel(); };
  const crumbs = <PageBreadcrumbs items={[{ label: t('nav.masterData') }, { label: title },
    { label: entry ? entryCode(entry) : editorTitle }]} />;
  return <>
    <DetailPageLayout title={editorTitle} breadcrumbs={crumbs} onBack={maybeCancel} backLabel={t('common.back')} naturalFlow error={error}
      actions={!editing && canEdit && <ActionButton action="edit" onClick={submit}>{t('master.editAction')}</ActionButton>}
      footer={editing && <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <ActionButton action="cancel" disabled={pending} onClick={maybeCancel}>{t('common.cancel')}</ActionButton>
        <ActionButton action="save" type="submit" form={formId} disabled={pending || !submitReady}>{action}</ActionButton>
      </Stack>}>
      <Stack id={formId} component="form" spacing={2} onSubmit={event => { event.preventDefault(); if (submitReady && !pending) submit(); }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}><Typography variant="h2">{t('master.general')}</Typography>{fieldsContent}</Stack>
        </Paper>
        {supplierTable && <Paper variant="outlined" sx={{ p: 2 }}>{supplierTable}</Paper>}
      </Stack>
    </DetailPageLayout>
    {picker && <SupplierPicker excluded={shownSuppliers.map(item => item.id)} onClose={() => setPicker(false)}
      onConfirm={items => { setChangedSuppliers([...shownSuppliers, ...items]); setPicker(false); }} />}
    {discard && <DiscardDialog onKeep={() => setDiscard(false)} onDiscard={cancel} />}
    {guard}
  </>;
}
