import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddTaskOutlined from '@mui/icons-material/AddTaskOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { StatusChip } from '../../shared/components';
import { StatusTone } from '../../config/theme';
import { fmtDate, num } from '../../shared/utils/format';
import { Proposal, ScDetail, ScLine } from './types';

const proposalTone: Record<string, StatusTone> = { PENDING: 'pending', APPROVED: 'success', REJECTED: 'danger' };

export type LineAction = { kind: 'add' } | { kind: 'edit' | 'delete' | 'propose'; line: ScLine } | { kind: 'approve' | 'reject'; proposal: Proposal };

/** Lines of the contract with per-line actions; proposed products are listed under their line. */
export function ScLinesTab({ d, can, onAction }: { d: ScDetail; can: (p: string) => boolean; onAction: (a: LineAction) => void }) {
  const { t } = useTranslation();
  const editable = d.status === 'DRAFT' && can('SALES_CONTRACT.CREATE');
  const canPropose = d.status !== 'CANCELED' && can('SALES_CONTRACT.PROPOSE_PRODUCT');
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
        <TableContainer>
          <Table size="small" aria-label={t('sc.tabLines')}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 48 }}>#</TableCell>
                <TableCell>{t('sc.itemCode')}</TableCell>
                <TableCell>{t('sc.itemName')}</TableCell>
                <TableCell align="right" sx={{ width: 110 }}>{t('gr.quantity')}</TableCell>
                <TableCell sx={{ width: 90 }}>{t('sc.uom')}</TableCell>
                <TableCell>{t('sc.allowedProducts')}</TableCell>
                {(editable || canPropose) && <TableCell align="right" sx={{ width: 128 }}>{t('common.actions')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {d.lines.map((l, i) => (
                <Fragment key={l.id}>
                  <TableRow hover>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.itemCode}</TableCell>
                    <TableCell>{l.itemName}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{num(l.quantity)}</TableCell>
                    <TableCell>{l.uomName}</TableCell>
                    <TableCell>{l.products.length ? t('sc.proposals', { count: l.products.length }) : <Typography variant="body2" color="text.secondary">{t('sc.noProducts')}</Typography>}</TableCell>
                    {(editable || canPropose) && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {canPropose && icon(t('sc.propose'), AddTaskOutlined, () => onAction({ kind: 'propose', line: l }))}
                        {editable && icon(t('sc.editItem'), EditOutlined, () => onAction({ kind: 'edit', line: l }))}
                        {editable && icon(t('sc.deleteItem'), DeleteOutline, () => onAction({ kind: 'delete', line: l }), 'error')}
                      </TableCell>
                    )}
                  </TableRow>
                  {l.products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell />
                      <TableCell colSpan={(editable || canPropose) ? 6 : 5}>
                        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 1, alignItems: { md: 'center' } }}>
                          <Stack sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.partNumber}: {p.name}</Typography>
                              <StatusChip label={t(`sc.proposal.${p.status}`)} tone={proposalTone[p.status]} />
                            </Stack>
                            <Typography variant="body2" color="text.secondary">{t('sc.proposedBy', { name: p.proposedByName, reason: p.reason })}</Typography>
                            {p.decidedByName && (
                              <Typography variant="body2" color="text.secondary">
                                {t('sc.decidedBy', { name: p.decidedByName, at: fmtDate(p.decidedAt!) })}{p.decisionNote ? `. ${p.decisionNote}` : ''}
                              </Typography>
                            )}
                          </Stack>
                          {p.status === 'PENDING' && can('SALES_CONTRACT.CONFIRM_PRODUCT') && (
                            <Stack direction="row" spacing={1}>
                              <Button size="small" color="error" onClick={() => onAction({ kind: 'reject', proposal: p })}>{t('doc.reject')}</Button>
                              <Button size="small" variant="contained" onClick={() => onAction({ kind: 'approve', proposal: p })}>{t('gir.confirm')}</Button>
                            </Stack>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
