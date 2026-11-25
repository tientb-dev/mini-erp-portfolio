import { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, IconButton, MenuItem, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import LinkOff from '@mui/icons-material/LinkOff';
import { api, ApiError, catalogSelectionPath } from '../../services/api-client';
import { DetailPageLayout, ErrorAlert, FormDialog, GridText, PageBreadcrumbs, ScrollTable } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { DiscardDialog, RouteDiscardGuard } from '../../shared/components/FormDialog';
import { trimDecimal } from '../../shared/utils/format';
import { Catalog, displayDecimal, Entry, entryCode, FieldKey, label, statusLabel } from './catalogs';

type Options = { data?: Entry[]; error: Error | null };
const booleans = new Set<FieldKey>(['isSerialTracked', 'allowAvailableStockIssue']);
const integers = new Set<FieldKey>(['brandId', 'unitOfMeasureId', 'decimalPlaces']);
const defaults: Partial<Record<FieldKey, string>> = { isSerialTracked: 'true', allowAvailableStockIssue: 'false', decimalPlaces: '0', rate: '0' };

export function CatalogEditor({ catalog, entry, close, report, showingResult, permissions, brands, uoms }: {
  catalog: Catalog; entry?: Entry; close: (result?: ActionResult) => void; report: (result: ActionResult) => void; showingResult: boolean; permissions: string[]; brands: Options; uoms: Options;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const router = useContext(UNSAFE_DataRouterContext);
  const [editing, setEditing] = useState(!entry);
  const [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fields, setFields] = useState<Partial<Record<FieldKey, string>>>({});
  const [newSupplier, setNewSupplier] = useState('');
  const [changedSuppliers, setChangedSuppliers] = useState<number[]>();
  const allowNavigation = useRef(false);
  const path = `/${catalog.path}${entry ? `/${entry.id}` : ''}`;
  const canEdit = permissions.includes(catalog.update);
  const canRemove = Boolean(entry && canEdit && catalog.remove && !(catalog.key === 'currencies' && entry.code === 'VND'));
  const showSupplierLinks = catalog.key === 'brands' && Boolean(entry) && permissions.includes('SUPPLIER.VIEW');
  const linked = useQuery({ queryKey: [path + '/suppliers'], queryFn: () => api<Entry[]>(path + '/suppliers'), enabled: showSupplierLinks });
  const suppliers = useQuery({ queryKey: ['suppliers', 'selection'], queryFn: () => api<Entry[]>(catalogSelectionPath('/suppliers')), enabled: showSupplierLinks && editing });
  const linkedIds = linked.data?.map(item => item.id) ?? [];
  const shownSuppliers = (changedSuppliers ?? linkedIds).flatMap(id => {
    const supplier = linked.data?.find(item => item.id === id) ?? suppliers.data?.find(item => item.id === id);
    return supplier ? [supplier] : [];
  });
  const initial = (field: FieldKey) => {
    const value = entry?.[field];
    if (typeof value === 'string' && (field === 'exchangeRate' || field === 'rate')) return trimDecimal(value);
    return value === undefined || value === null ? defaults[field] ?? '' : String(value);
  };
  const value = (field: FieldKey) => fields[field] ?? initial(field);
  const dirty = editing && (catalog.fields.some(field => value(field) !== initial(field)) ||
    (changedSuppliers !== undefined && [...changedSuppliers].sort().join() !== [...linkedIds].sort().join()));
  const vnd = catalog.key === 'currencies' && value('code') === 'VND';
  const resultFor = (action: string, success: boolean, error?: unknown): ActionResult => ({
    ...(success ? { success: true as const } : { success: false as const, error }),
    title: t(success ? 'master.resultSuccess' : 'master.resultFailure', { action }),
    message: t('master.resultTarget', { name: value('name'), code: value(catalog.key === 'products' ? 'partNumber' : 'code') }),
  });
  const inlineField = (error: unknown) => error instanceof ApiError
    ? (({ INVALID_EXCHANGE_RATE: 'exchangeRate', INVALID_TAX_RATE: 'rate', PRODUCT_UOM_LOCKED: 'unitOfMeasureId',
        PRODUCT_IDENTITY_LOCKED: 'partNumber', SERIAL_TRACKING_LOCKED: 'isSerialTracked', DUPLICATE_VALUE: catalog.key === 'products' ? 'partNumber' : 'code' }) as Record<string, FieldKey>)[error.code]
    : undefined;
  const saveAction = t(entry ? 'doc.saveEdit' : 'master.addAction');
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(catalog.fields.map(field => {
        const raw = value(field).trim();
        return [field, field === 'exchangeRate' && vnd ? '1' : booleans.has(field) ? raw === 'true' : integers.has(field) ? Number(raw) : raw];
      }));
      if (changedSuppliers !== undefined) return api(path, { method: 'PATCH', body: JSON.stringify({ ...body, supplierIds: changedSuppliers }) });
      return api(path, { method: entry ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [catalog.key === 'unitsOfMeasure' ? 'uoms' : catalog.path] });
      if (showSupplierLinks) await qc.invalidateQueries({ queryKey: [path + '/suppliers'] });
      const result = resultFor(saveAction, true);
      if (entry) { resetEditor(); report(result); }
      else { allowNavigation.current = true; close(result); }
    },
    onError: error => { if (!inlineField(error)) report(resultFor(saveAction, false, error)); },
  });
  const remove = useMutation({
    mutationFn: () => api(path, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [catalog.path] });
      allowNavigation.current = true;
      close(resultFor(t('prCatalog.delete'), true));
    },
    onError: error => { setDeleting(false); report(resultFor(t('prCatalog.delete'), false, error)); },
  });
  const pending = save.isPending || remove.isPending;
  useEffect(() => {
    if (!catalog.fullPage || (!dirty && !pending)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [catalog.fullPage, dirty, pending]);
  const resetEditor = () => {
    setEditing(false);
    setFields({});
    setNewSupplier('');
    setChangedSuppliers(undefined);
    setDiscard(false);
    save.reset();
  };
  const cancel = () => {
    if (deleting) { setDeleting(false); remove.reset(); }
    else if (entry && editing) resetEditor();
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
    const maxLength = field === 'partNumber' ? 100 : field === 'code' ? catalog.key === 'unitsOfMeasure' ? 20 : catalog.key === 'temporaryProducts' ? 100 : 50
      : field === 'name' ? catalog.key === 'unitsOfMeasure' ? 100 : catalog.key === 'warehouses' ? 200 : 300 : undefined;
    if (maxLength && raw.length > maxLength) fieldErrors[field] = t('master.tooLong', { count: maxLength });
  }
  const submitReady = Object.keys(fieldErrors).length === 0;
  const apiField = inlineField(save.error);
  const renderField = (field: FieldKey) => {
    const raw = value(field);
    const options = field === 'brandId' ? brands.data : field === 'unitOfMeasureId' ? uoms.data : undefined;
    const select = Boolean(options) || integers.has(field) && field !== 'decimalPlaces' || booleans.has(field);
    const locked = !editing || (catalog.key === 'products' && entry?.isUsed && ['name', 'partNumber', 'unitOfMeasureId'].includes(field))
      || (field === 'isSerialTracked' && entry?.isStockUsed) || (field === 'exchangeRate' && vnd)
      || (field === 'code' && entry?.code === 'VND' && catalog.key === 'currencies');
    const issue = editing ? (apiField === field ? save.error?.message : raw !== '' || fields[field] !== undefined ? fieldErrors[field] : undefined) : undefined;
    const fixed = field === 'exchangeRate' && vnd ? '1' : raw;
    const shown = !editing && (field === 'exchangeRate' || field === 'rate') && fixed ? displayDecimal(fixed, i18n.language) : fixed;
    return (
      <DocumentFormCell key={field} span={field === 'description' ? 12 : catalog.key === 'products' ? 4 : 6}>
        <TextField fullWidth size="small" label={label(t, field)} value={select && !booleans.has(field) && !options?.some(item => String(item.id) === shown) ? '' : shown}
          disabled={pending || Boolean(select && (locked || integers.has(field) && !options))}
          slotProps={{ input: select ? undefined : { readOnly: Boolean(locked) }, htmlInput: { inputMode: field === 'decimalPlaces' ? 'numeric' : ['rate', 'exchangeRate'].includes(field) ? 'decimal' : undefined } }}
          select={select} required={editing && field !== 'description'} multiline={field === 'description'} minRows={field === 'description' ? 2 : undefined}
          error={Boolean(issue)} helperText={issue} onChange={event => { setFields({ ...fields, [field]: event.target.value }); save.reset(); }}>
          {select && (booleans.has(field)
            ? ['true', 'false'].map(flag => <MenuItem key={flag} value={flag}>{t(flag === 'true' ? 'common.yes' : 'common.no')}</MenuItem>)
            : (options ?? []).map(item => <MenuItem key={item.id} value={String(item.id)}>{item.code} · {item.name}</MenuItem>))}
        </TextField>
      </DocumentFormCell>
    );
  };
  const deleteAction = canRemove && !editing && !deleting && <Button color="error" variant="outlined" onClick={() => setDeleting(true)}>{t('prCatalog.delete')}</Button>;
  const supplierTable = showSupplierLinks && (
    <Stack spacing={1.5}>
      <Typography variant="h2">{t('master.linkedSuppliers')}</Typography>
      <ErrorAlert error={linked.error ?? suppliers.error} />
      {editing && linked.isSuccess && suppliers.isSuccess && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-end' } }}>
          <TextField select size="small" fullWidth label={t('master.chooseSupplier')} value={newSupplier} onChange={event => setNewSupplier(event.target.value)}>
            <MenuItem value="">{t('master.chooseSupplier')}</MenuItem>
            {suppliers.data.filter(item => !(changedSuppliers ?? linkedIds).includes(item.id))
              .map(item => <MenuItem value={String(item.id)} key={item.id}>{item.code} · {item.name}</MenuItem>)}
          </TextField>
          <Button variant="contained" disabled={!newSupplier} onClick={() => {
            setChangedSuppliers([...(changedSuppliers ?? linkedIds), Number(newSupplier)]); setNewSupplier('');
          }} sx={{ whiteSpace: 'nowrap', height: 40, flexShrink: 0 }}>{t('master.addSupplier')}</Button>
        </Stack>
      )}
      {linked.isPending ? <Typography>{t('common.loading')}</Typography> : shownSuppliers.length === 0 ? <Typography>{t('common.empty')}</Typography> :
        <ScrollTable label={t('master.linkedSuppliers')} columnWidths={[140, 235, ...(editing ? [96] : [])]} maxHeight="330px">
          <TableHead><TableRow><TableCell>{label(t, 'code')}</TableCell><TableCell>{label(t, 'name')}</TableCell>
            {editing && <TableCell align="right" data-grid-actions>{t('common.actions')}</TableCell>}
          </TableRow></TableHead>
          <TableBody>{shownSuppliers.map(item => <TableRow key={item.id}>
            <TableCell><GridText to={`/suppliers/${item.id}`} value={item.code ?? ''} /></TableCell>
            <TableCell><GridText value={item.name} /></TableCell>
            {editing && <TableCell align="right" data-grid-actions><Tooltip title={t('master.unlinkSupplier')}>
              <IconButton aria-label={`${t('master.unlinkSupplier')} ${item.code}`} color="error" size="small"
                onClick={() => setChangedSuppliers((changedSuppliers ?? linkedIds).filter(id => id !== item.id))}><LinkOff fontSize="small" /></IconButton>
            </Tooltip></TableCell>}
          </TableRow>)}</TableBody>
        </ScrollTable>}
    </Stack>
  );
  const fieldsContent = <DocumentFormGrid>
    {catalog.fields.map(renderField)}
    {!editing && <DocumentFormCell span={4}>
      <TextField fullWidth size="small" label={t('common.status')} value={statusLabel(t, Boolean(entry?.isActive))}
        slotProps={{ input: { readOnly: true } }} />
    </DocumentFormCell>}
  </DocumentFormGrid>;
  const error = brands.error ?? uoms.error;
  const action = deleting ? t('prCatalog.delete') : editing ? t(entry ? 'doc.saveEdit' : 'prCatalog.save') : canEdit ? t('master.editAction') : undefined;
  const submit = () => {
    if (deleting) remove.mutate();
    else if (editing) save.mutate();
    else setEditing(true);
  };
  const deleteHint = t('prCatalog.deleteEntry', { name: entry?.name });
  if (!catalog.fullPage) return (
    <>
    {!showingResult && <FormDialog pageGuardsNavigation title={deleting ? deleteHint : editorTitle} submitLabel={action}
      closeLabel={!editing && !deleting ? t('common.close') : undefined}
      error={error} pending={pending} canSubmit={!editing || submitReady} onSubmit={submit} onClose={cancel}
      dirty={dirty} submitColor={deleting ? 'error' : 'primary'}>
      {!deleting && fieldsContent}
      {deleteAction}
    </FormDialog>}
    {router && <RouteDiscardGuard dirty={dirty} pending={pending} allowNavigation={() => allowNavigation.current} />}
    </>
  );
  const maybeCancel = () => dirty ? setDiscard(true) : cancel();
  const crumbs = <PageBreadcrumbs items={[{ label: t('nav.masterData') }, { label: title },
    { label: entry ? entryCode(entry) : editorTitle }]} />;
  return (
    <>
      <DetailPageLayout title={editorTitle} breadcrumbs={crumbs} onBack={maybeCancel} backLabel={t('common.back')} naturalFlow error={error}
        actions={!editing && !deleting && <Stack direction="row" spacing={1}>
          {deleteAction}{canEdit && <Button variant="contained" onClick={submit}>{t('master.editAction')}</Button>}
        </Stack>}>
        <Stack component="form" spacing={2} onSubmit={event => { event.preventDefault(); if (submitReady && !pending) submit(); }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            {deleting ? <Typography>{deleteHint}</Typography> :
              <Stack spacing={1.5}><Typography variant="h2">{t('master.general')}</Typography>{fieldsContent}</Stack>}
          </Paper>
          {supplierTable && !deleting && <Paper variant="outlined" sx={{ p: 2 }}>{supplierTable}</Paper>}
          {(editing || deleting) && <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button variant="outlined" disabled={pending} onClick={maybeCancel}>{t('common.cancel')}</Button>
            <Button variant="contained" type="submit" disabled={pending || !submitReady} color={deleting ? 'error' : 'primary'}>{action}</Button>
          </Stack>}
        </Stack>
      </DetailPageLayout>
      {discard && <DiscardDialog onKeep={() => setDiscard(false)} onDiscard={cancel} />}
      {router && <RouteDiscardGuard dirty={dirty} pending={pending} allowNavigation={() => allowNavigation.current} />}
    </>
  );
}
