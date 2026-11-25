import { Button, Divider, IconButton, Stack, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import Add from '@mui/icons-material/Add';
import Edit from '@mui/icons-material/Edit';
import Delete from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { GridText, ScrollTable } from '../../shared/components';
import type { DocLine } from './types';

export type PrDisplayLine = Pick<DocLine, 'partNumber' | 'productName' | 'uom' | 'quantity' | 'ref' | 'usedQuantity'>;

export function PrLineTable({ lines, onAdd, onEdit, onDelete, invalid, addDisabled, addHint }: {
  lines: PrDisplayLine[]; onAdd?: () => void; onEdit?: (index: number) => void; onDelete?: (index: number) => void; invalid?: boolean;
  addDisabled?: boolean; addHint?: string;
}) {
  const { t } = useTranslation();
  const hasUsed = !onEdit && lines.some(line => line.usedQuantity !== undefined);
  return (
    <>
      <Divider />
      <Stack spacing={{ xs: 1, xl: 1.5 }} sx={{ p: { xs: 1.5, xl: 2 } }} id="pr-lines" tabIndex={-1}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="h2">{t('pr.goods')}</Typography>
          {onAdd && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            {addHint && <Typography id="pr-add-goods-hint" variant="body2" color="text.secondary">{addHint}</Typography>}
            <Button startIcon={<Add />} variant="outlined" onClick={onAdd} disabled={addDisabled}
              aria-describedby={addHint ? 'pr-add-goods-hint' : undefined}>{t('pr.addGoods')}</Button>
          </Stack>}
        </Stack>
        {invalid && <Typography role="alert" color="error">{t('errors.PR_LINES_REQUIRED')}</Typography>}
        <ScrollTable label={t('pr.goods')} columnWidths={[42, 144, 200, 152, 86, 76, ...(hasUsed ? [100] : []), ...(onEdit ? [88] : [])]} maxHeight="clamp(160px, calc(100dvh - 570px), 360px)">
          <TableHead><TableRow>
            <TableCell>#</TableCell><TableCell>{t('product.partNumber')}</TableCell>
            <TableCell>{t('product.name')}</TableCell><TableCell>{t('pr.lineRef')}</TableCell>
            <TableCell align="right">{t('gr.quantity')}</TableCell><TableCell>{t('product.uom')}</TableCell>
            {hasUsed && <TableCell align="right">{t('pr.used')}</TableCell>}
            {onEdit && <TableCell data-grid-actions>{t('pr.lineActions')}</TableCell>}
          </TableRow></TableHead>
          <TableBody>
            {!lines.length && <TableRow><TableCell colSpan={6 + Number(hasUsed) + Number(Boolean(onEdit))} align="center" sx={{ py: { xs: 3, xl: 4 } }}>
              {t('pr.noGoods')}
            </TableCell></TableRow>}
            {lines.map((line, index) => (
              <TableRow key={index}>
                <TableCell>{index + 1}</TableCell><TableCell><GridText value={line.partNumber} /></TableCell>
                <TableCell><GridText value={line.productName} /></TableCell><TableCell><GridText value={line.ref || '—'} /></TableCell>
                <TableCell align="right">{Number(line.quantity).toLocaleString()}</TableCell><TableCell><GridText value={line.uom} /></TableCell>
                {hasUsed && <TableCell align="right">{line.usedQuantity == null ? '—' : Number(line.usedQuantity).toLocaleString()}</TableCell>}
                {onEdit && <TableCell data-grid-actions>
                  <Tooltip title={t('doc.edit')}><IconButton size="small" color="primary" aria-label={t('pr.editGoodsAt', { row: index + 1 })} onClick={() => onEdit(index)}><Edit fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title={t('pr.deleteGoods')}><IconButton size="small" color="error" aria-label={t('pr.deleteGoodsAt', { row: index + 1 })} onClick={() => onDelete?.(index)}><Delete fontSize="small" /></IconButton></Tooltip>
                </TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </ScrollTable>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>{t('pr.goodsCount', { count: lines.length })}</Typography>
      </Stack>
    </>
  );
}
