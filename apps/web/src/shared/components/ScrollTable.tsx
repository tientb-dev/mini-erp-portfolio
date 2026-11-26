import { ReactNode } from 'react';
import { Table, TableContainer } from '@mui/material';
import { fillMedia, tokens } from '../../config/theme';

/**
 * Data table of a document detail (items, materials, serials): sticky column headers, horizontal scroll inside its own
 * box, natural height for a few rows. On fill screens it is the region that shrinks and scrolls vertically, so the page
 * header, tabs and footer stay put; elsewhere the main area scrolls as a whole.
 */
export function ScrollTable({ label, minWidth, children, maxHeight, columnWidths, stickyLeftWidth }: { label: string; minWidth?: number; children: ReactNode; maxHeight?: string; columnWidths?: (number | string | undefined)[]; stickyLeftWidth?: number }) {
  const width = columnWidths?.reduce<number>((total, column) => total + (typeof column === 'number' ? column : 0), 0);
  return (
    <TableContainer data-fill-grow sx={{ overflow: 'auto', maxHeight, isolation: stickyLeftWidth ? 'isolate' : undefined,
      scrollPaddingLeft: stickyLeftWidth, scrollPaddingRight: stickyLeftWidth ? 96 : undefined, scrollPaddingTop: stickyLeftWidth ? 44 : undefined,
      [fillMedia]: { flex: '0 1 auto', minHeight: 0 } }}>
      <Table stickyHeader size="small" aria-label={label} sx={{
        minWidth: minWidth ?? width,
        '& thead th:not(:last-of-type)': { borderRight: '1px solid', borderRightColor: tokens.gridSeparator },
        '& tbody tr': {
          height: columnWidths ? 44 : undefined,
          '--grid-row-bg': tokens.surface,
          bgcolor: 'var(--grid-row-bg)',
          '&:nth-of-type(even)': { '--grid-row-bg': tokens.gridEven },
          '&:hover': { '--grid-row-bg': tokens.gridHover },
          '&.Mui-selected, &.Mui-selected:hover': { '--grid-row-bg': tokens.gridSelected, bgcolor: 'var(--grid-row-bg)' },
          '& > td, & > th': { borderBottomColor: tokens.gridSeparator },
        },
        ...(columnWidths && {
          tableLayout: 'fixed',
          '& td': { paddingBlock: '6px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
          '& th': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          ...(stickyLeftWidth && { '& th, & td': { paddingInline: '8px' } }),
          '& [data-grid-left]': { position: 'sticky', zIndex: 1, bgcolor: 'var(--grid-row-bg, #fff)' },
          '& thead [data-grid-left]': { zIndex: 3, bgcolor: tokens.gridHeader },
          '& [data-grid-actions]': { position: 'sticky', right: 0, zIndex: 1, bgcolor: 'var(--grid-row-bg, #fff)', borderLeft: 1, borderColor: tokens.gridSeparator },
          '& thead [data-grid-actions]': { zIndex: 3, bgcolor: tokens.gridHeader },
          '& .MuiTableCell-alignRight': { fontVariantNumeric: 'tabular-nums' },
        }),
      }}>
        {columnWidths && <colgroup>{columnWidths.map((column, index) => <col key={index} style={{ width: column }} />)}</colgroup>}
        {children}
      </Table>
    </TableContainer>
  );
}
