import { ReactNode } from 'react';
import { Table, TableContainer } from '@mui/material';
import { fillMedia } from '../../config/theme';

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
        ...(columnWidths && {
          tableLayout: 'fixed',
          '& tbody tr': { height: 44 },
          '& td': { paddingBlock: '6px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
          '& th': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          ...(stickyLeftWidth && { '& th, & td': { paddingInline: '8px' } }),
          '& [data-grid-left]': { position: 'sticky', zIndex: 1, bgcolor: 'background.paper' },
          '& thead [data-grid-left]': { zIndex: 3, bgcolor: 'background.default' },
          '& [data-grid-actions]': { position: 'sticky', right: 0, zIndex: 1, bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider' },
          '& thead [data-grid-actions]': { zIndex: 3, bgcolor: 'background.default' },
          '& .MuiTableCell-alignRight': { fontVariantNumeric: 'tabular-nums' },
        }),
      }}>
        {columnWidths && <colgroup>{columnWidths.map((column, index) => <col key={index} style={{ width: column }} />)}</colgroup>}
        {children}
      </Table>
    </TableContainer>
  );
}
