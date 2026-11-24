import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api-client';
import { FormDialog } from '../../shared/components';
import { num } from '../../shared/utils/format';
import type { Product } from '../master-data';
import { CreateProps } from './types';
import { useMe } from '../identity';
import { saveDoc } from './api';
import { EditHint } from './SourceLines';

export interface ScOption { id: number; documentNumber: string; status: string; customerName: string; responsibleSalesUserId?: number; responsiblePmUserId?: number }
export interface ScLineOption { id: number; itemCode: string; itemName: string; uomName: string; quantity: string }

export function CreatePrDialog({ onClose, onCreated, edit }: CreateProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [scId, setScId] = useState(edit ? String(edit.salesContractId) : '');
  // Sales goods follow the HĐ lines; materials are free lines with an optional HĐ line (CM3: one category per PR).
  const [category, setCategory] = useState<string>(edit ? String(edit.category ?? 'SALES_GOODS') : 'SALES_GOODS');
  const [route, setRoute] = useState('');
  const [approverId, setApproverId] = useState(String(edit?.draftApproverId ?? ''));
  const [receiverId, setReceiverId] = useState(String(edit?.draftReceiverId ?? ''));
  const [purpose, setPurpose] = useState('');
  const [materials, setMaterials] = useState<{ id?: number; productId: string; quantity: string }[]>(
    () => (edit?.category === 'MATERIAL' ? edit.lines.map((l) => ({ id: l.id, productId: String(l.productId), quantity: String(num(l.quantity)) })) : [{ productId: '', quantity: '' }]));
  // Keyed by HĐ line: a PR holds at most one line per HĐ line (CM6, enforced by the API).
  const [lines, setLines] = useState<Record<number, { id?: number; productId: string; quantity: string }>>(
    () => Object.fromEntries((edit?.lines ?? []).map((l) => [l.sourceLineId, { id: l.id, productId: String(l.productId), quantity: String(num(l.quantity)) }])));
  const contracts = useQuery({ queryKey: ['scs'], queryFn: () => api<ScOption[]>('/sales-contracts') });
  const scLines = useQuery({ queryKey: ['sc-lines', scId], queryFn: () => api<ScLineOption[]>(`/sales-contracts/${scId}/lines`), enabled: Boolean(scId) });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products') });
  const touched = (line: { productId: string; quantity: string }) => Boolean(line.productId || line.quantity);
  const valid = (line: { productId: string; quantity: string }) => Boolean(line.productId && Number.isFinite(Number(line.quantity)) && Number(line.quantity) > 0);
  const chosen = Object.entries(lines).filter(([, line]) => touched(line));
  const chosenMaterials = materials.filter(touched);
  const invalidLines = category === 'MATERIAL' ? chosenMaterials.some(line => !valid(line)) : chosen.some(([, line]) => !valid(line));
  function routesFor(contract: ScOption) {
    const user = me.data;
    if (!user) return [];
    const routes = [];
    if (contract.responsibleSalesUserId === user.id) routes.push('SALES');
    if (contract.responsiblePmUserId === user.id) routes.push('PM');
    return routes;
  }
  const eligibleContracts = (contracts.data ?? []).filter(c => edit ? String(c.id) === scId : c.status === 'ACTIVE' && routesFor(c).length);
  const selected = eligibleContracts.find(c => String(c.id) === scId);
  const multipleRoutes = !!selected && !edit && routesFor(selected).length > 1;
  const candidates = useQuery({
    queryKey: ['pr-draft-candidates', edit?.id, scId, route],
    queryFn: () => api<{ approvers: { id: number; fullName: string }[]; receivers: { id: number; fullName: string }[] }>(edit
      ? `/purchase-requisitions/${edit.id}/candidates`
      : `/pr-workflow/creator-candidates?salesContractId=${scId}${route ? `&route=${route}` : ''}`),
    enabled: Boolean(edit || (selected && (!multipleRoutes || route))),
  });
  const approver = candidates.data?.approvers.some(person => person.id === Number(approverId)) ? approverId : '';
  const receiver = candidates.data?.receivers.some(person => person.id === Number(receiverId)) ? receiverId : '';
  const isMaterial = category === 'MATERIAL';
  const create = useMutation({
    mutationFn: () => saveDoc('purchase-requisitions', edit, {
      ...(edit ? {} : { salesContractId: Number(scId), route: route || undefined, category, purpose: isMaterial && purpose.trim() ? purpose.trim() : undefined }),
      ...(candidates.data ? { approverId: approver ? Number(approver) : null, receiverId: receiver ? Number(receiver) : null } : {}),
      lines: isMaterial
        ? chosenMaterials.map((l) => ({ id: l.id, productId: Number(l.productId), quantity: num(l.quantity) }))
        : chosen.map(([lineId, l]) => ({ id: l.id, salesContractLineId: Number(lineId), productId: Number(l.productId), quantity: num(l.quantity) })),
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['pr'] }); onCreated(r.id); },
  });
  return (
    <FormDialog title={edit ? t('doc.editTitle', { number: edit.documentNumber }) : t('pr.create')} submitLabel={t(edit ? 'doc.saveEdit' : 'pr.create')} error={create.error} pending={create.isPending}
      canSubmit={Boolean(!invalidLines && scId && (!multipleRoutes || route) && (isMaterial ? chosenMaterials.length : chosen.length))} onSubmit={() => create.mutate()} onClose={onClose}>
      {invalidLines && <Typography color="error">{t('pr.invalidLines')}</Typography>}
      <EditHint edit={edit} hint={t('pr.createHint')} />
      <TextField select disabled={Boolean(edit)} label={t('pr.category')} value={category} onChange={(e) => setCategory(e.target.value)}
        helperText={t(isMaterial ? 'pr.materialHint' : 'pr.salesGoodsHint')}>
        {['SALES_GOODS', 'MATERIAL'].map((c) => <MenuItem key={c} value={c}>{t(`category.${c}`)}</MenuItem>)}
      </TextField>
      <TextField select disabled={Boolean(edit)} label={t('gir.salesContract')} value={scId} onChange={(e) => { setScId(e.target.value); setLines({}); setRoute(''); setApproverId(''); setReceiverId(''); }} required
        helperText={contracts.data && !eligibleContracts.length ? t('pr.noActiveContract') : undefined}>
        {eligibleContracts.map((c) => <MenuItem key={c.id} value={c.id}>{c.documentNumber}: {c.customerName}</MenuItem>)}
      </TextField>
      {multipleRoutes && <TextField select required label={t('pr.route')} value={route} onChange={e => { setRoute(e.target.value); setApproverId(''); }}>
        {routesFor(selected).map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
      </TextField>}
      {candidates.error && <Typography color="error">{candidates.error.message}</Typography>}
      {candidates.data && <>
        <TextField select label={t('gr.approver')} value={approver} onChange={e => setApproverId(e.target.value)}
          helperText={!candidates.data.approvers.length ? t('pr.emptyPool') : undefined}>
          <MenuItem value="">{t('pr.noSelection')}</MenuItem>
          {candidates.data.approvers.map(person => <MenuItem key={person.id} value={person.id}>{person.fullName}</MenuItem>)}
        </TextField>
        <TextField select label={t('pr.receiver')} value={receiver} onChange={e => setReceiverId(e.target.value)}
          helperText={!candidates.data.receivers.length ? t('pr.emptyPool') : undefined}>
          <MenuItem value="">{t('pr.noSelection')}</MenuItem>
          {candidates.data.receivers.map(person => <MenuItem key={person.id} value={person.id}>{person.fullName}</MenuItem>)}
        </TextField>
      </>}
      {isMaterial && !edit && <TextField label={t('gir.purpose')} value={purpose} onChange={(e) => setPurpose(e.target.value)} helperText={t('pr.purposeHint')} />}
      {isMaterial && scId && materials.map((v, i) => (
        <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <TextField select fullWidth label={t('pr.material', { n: i + 1 })} value={v.productId}
            onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
            {(products.data ?? []).filter((p) => p.isActive).map((p) => <MenuItem key={p.id} value={p.id}>{p.partNumber}: {p.name} ({p.unitOfMeasure.code})</MenuItem>)}
          </TextField>
          <TextField label={t('gr.quantity')} type="number" value={v.quantity} sx={{ maxWidth: { sm: 160 } }} slotProps={{ htmlInput: { min: 0 } }}
            onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
        </Stack>
      ))}
      {isMaterial && scId && <Button onClick={() => setMaterials([...materials, { productId: '', quantity: '' }])} sx={{ alignSelf: 'flex-start' }}>{t('pr.addMaterial')}</Button>}
      {!isMaterial && (scLines.data ?? []).map((l) => {
        const v = lines[l.id] ?? { productId: '', quantity: '' };
        return (
          <Stack key={l.id} spacing={1} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.itemCode}: {l.itemName} ({num(l.quantity)} {l.uomName})</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField select fullWidth label={t('pr.product')} value={v.productId} onChange={(e) => setLines({ ...lines, [l.id]: { ...v, productId: e.target.value, quantity: e.target.value ? v.quantity : '' } })}>
                <MenuItem value="">{t('pr.skipLine')}</MenuItem>
                {(products.data ?? []).filter((p) => p.isActive).map((p) => <MenuItem key={p.id} value={p.id}>{p.partNumber}: {p.name} ({p.unitOfMeasure.code})</MenuItem>)}
              </TextField>
              <TextField label={t('gr.quantity')} type="number" value={v.quantity} sx={{ maxWidth: { sm: 160 } }} slotProps={{ htmlInput: { min: 0 } }}
                onChange={(e) => setLines({ ...lines, [l.id]: { ...v, quantity: e.target.value } })} />
            </Stack>
          </Stack>
        );
      })}
    </FormDialog>
  );
}
