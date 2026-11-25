import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, IconButton, Stack, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddTaskOutlined from '@mui/icons-material/AddTaskOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { DuplicateCodeWarning, findDuplicateCodeRows, GridText, ScrollTable, StatusChip } from '../../shared/components';
import { StatusTone } from '../../config/theme';
import { fmtDate, num } from '../../shared/utils/format';
import { Proposal, ScDetail, ScLine } from './types';

const proposalTone: Record<string, StatusTone> = { PENDING: 'pending', APPROVED: 'success', REJECTED: 'danger' };

export type LineAction = { kind: 'add' } | { kind: 'edit' | 'delete' | 'propose'; line: ScLine } | { kind: 'approve' | 'reject'; proposal: Proposal };

/** Lines of the contract with per-line actions; proposed products are listed under their line. */
export function ScLinesTab({ d, can, onAction }: { d: ScDetail; can: (p: string) => boolean; onAction: (a: LineAction) => void }) {
  const { t } = useTranslation();
  const duplicateRows = findDuplicateCodeRows(d.lines);
  const editable = d.status === 'DRAFT' && can('SALES_CONTRACT.CREATE');
  const canPropose = d.status !== 'CANCELED' && can('SALES_CONTRACT.PROPOSE_PRODUCT');
  const canConfirm = can('SALES_CONTRACT.CONFIRM_PRODUCT');
  const hasActions = editable || canPropose || (canConfirm && d.lines.some(line => line.products.some(p => p.status === 'PENDING')));
  const icon = (label: string, Icon: typeof EditOutlined, onClick: () => void, color?: 'error') => (
    <Tooltip title={label}><IconButton size="small" aria-label={label} onClick={onClick} color={color}><Icon fontSize="small" /></IconButton></Tooltip>
  );
  return (
    <>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, minHeight: 36 }}>
        <Typography variant="body2" color="text.secondary">{t('sc.lineSummary', { count: d.lines.length })}</Typography>
        {editable && <Button variant="contained" startIcon={<AddIcon />} onClick={() => onAction({ kind: 'add' })}>{t('sc.addItem')}</Button>}
      </Stack>
      {d.lines.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{t(editable ? 'sc.noLinesEdit' : 'sc.noLines')}</Typography>
      ) : (
        <ScrollTable label={t('sc.tabLines')} columnWidths={[42, 110, 174, 200, 190, 85, 92, 166, ...(hasActions ? [160] : [])]}
          maxHeight="clamp(170px, calc(100dvh - 515px), 440px)">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>{t('master.sourceType')}</TableCell>
                <TableCell>{t('sc.itemCode')}</TableCell>
                <TableCell>{t('sc.itemName')}</TableCell>
                <TableCell>{t('master.lineRequirement')}</TableCell>
                <TableCell align="right">{t('gr.quantity')}</TableCell>
                <TableCell>{t('sc.uom')}</TableCell>
                <TableCell>{t('sc.allowedProducts')}</TableCell>
                {hasActions && <TableCell align="right" data-grid-actions>{t('common.actions')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {d.lines.map((l, i) => (
                <Fragment key={l.id}>
                  <TableRow hover>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{l.productId ? <Chip size="small" label={t('prCatalog.main')}
                      sx={{ bgcolor: 'action.selected', color: 'primary.dark', fontWeight: 600, borderRadius: 1 }} />
                      : <StatusChip label={t(l.temporaryProductId ? 'prCatalog.temporary' : 'prCatalog.free')}
                        tone={l.temporaryProductId ? 'success' : 'neutral'} />}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}><GridText value={l.itemCode} trailing={<DuplicateCodeWarning rows={duplicateRows(l.itemCode, l.id)} />} /></TableCell>
                    <TableCell><GridText value={l.itemName} /></TableCell>
                    <TableCell><GridText value={l.itemDescription ?? ''} /></TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{num(l.quantity)}</TableCell>
                    <TableCell><GridText value={l.uomName} /></TableCell>
                    <TableCell>{l.products.length ? t('sc.proposals', { count: l.products.length }) : <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{t('sc.noProductsShort')}</Typography>}</TableCell>
                    {hasActions && (
                      <TableCell align="right" data-grid-actions>
                        {canPropose && icon(t('sc.propose'), AddTaskOutlined, () => onAction({ kind: 'propose', line: l }))}
                        {editable && icon(t('sc.editItem'), EditOutlined, () => onAction({ kind: 'edit', line: l }))}
                        {editable && icon(t('sc.deleteItem'), DeleteOutline, () => onAction({ kind: 'delete', line: l }), 'error')}
                      </TableCell>
                    )}
                  </TableRow>
                  {l.products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell />
                      <TableCell colSpan={7}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                          <StatusChip label={t(`sc.proposal.${p.status}`)} tone={proposalTone[p.status]} />
                          <GridText value={`${p.partNumber}: ${p.name}`} />
                          <GridText value={t('sc.proposedBy', { name: p.proposedByName, reason: p.reason })} />
                          {p.decidedByName && <GridText value={t('sc.decidedBy', { name: p.decidedByName, at: fmtDate(p.decidedAt!) })
                            + (p.decisionNote ? '. ' + p.decisionNote : '')} />}
                        </Stack>
                      </TableCell>
                      {hasActions && <TableCell align="right" data-grid-actions>
                        {p.status === 'PENDING' && canConfirm && (
                          <>
                            <Button size="small" color="error" onClick={() => onAction({ kind: 'reject', proposal: p })}>{t('doc.reject')}</Button>
                            <Button size="small" onClick={() => onAction({ kind: 'approve', proposal: p })}>{t('gir.confirm')}</Button>
                          </>
                        )}
                      </TableCell>}
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
        </ScrollTable>
      )}
    </>
  );
}
