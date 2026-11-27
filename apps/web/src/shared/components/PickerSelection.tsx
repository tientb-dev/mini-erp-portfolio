import { Checkbox } from '@mui/material';
import { gridVisibleRowsSelector, useGridApiContext, useGridSelector } from '@mui/x-data-grid';
import type { GridColDef, GridValidRowModel } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

function PickerPageCheckbox<R extends GridValidRowModel>({ isSelected, onChange, disabled }: {
  isSelected: (row: R) => boolean;
  onChange: (rows: R[], checked: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const apiRef = useGridApiContext();
  const { rows } = useGridSelector(apiRef, gridVisibleRowsSelector);
  const page = rows.map(entry => entry.model as R);
  const count = page.filter(isSelected).length;
  return <Checkbox size="small" disabled={disabled || !page.length}
    checked={count > 0 && count === page.length} indeterminate={count > 0 && count < page.length}
    slotProps={{ input: { 'aria-label': t('prPhase.selectPage'), 'aria-checked': count > 0 && count < page.length ? 'mixed' : undefined } }}
    onChange={event => onChange(page, event.target.checked)} />;
}

export function pickerSelectionColumn<R extends GridValidRowModel>(
  isSelected: (row: R) => boolean,
  onChange: (rows: R[], checked: boolean) => void,
  getLabel: (row: R) => string | undefined,
  disabled = false,
  /** Rows that cannot be picked (e.g. already assigned): shown checked and locked, skipped by the page checkbox. */
  isLocked?: (row: R) => boolean,
): GridColDef<R> {
  return {
    field: 'selection', headerName: '', width: 54, sortable: false, filterable: false, resizable: false,
    align: 'center', headerAlign: 'center', cellClassName: 'common-picker-check',
    renderHeader: () => <PickerPageCheckbox<R> isSelected={row => isSelected(row) || Boolean(isLocked?.(row))}
      onChange={(rows, checked) => onChange(rows.filter(row => !isLocked?.(row)), checked)} disabled={disabled} />,
    renderCell: ({ row, tabIndex }) => <Checkbox size="small" checked={isSelected(row) || Boolean(isLocked?.(row))} disabled={disabled || Boolean(isLocked?.(row))}
      slotProps={{ input: { 'aria-label': getLabel(row), tabIndex } }}
      onChange={event => onChange([row], event.target.checked)} />,
  };
}
