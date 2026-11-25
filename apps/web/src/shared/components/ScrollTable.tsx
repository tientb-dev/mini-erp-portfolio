import { ReactNode } from 'react';
import { Table, TableContainer } from '@mui/material';
import { fillMedia } from '../../config/theme';

/**
 * Data table of a document detail (items, materials, serials): sticky column headers, horizontal scroll inside its own
 * box, natural height for a few rows. On fill screens it is the region that shrinks and scrolls vertically, so the page
 * header, tabs and footer stay put; elsewhere the main area scrolls as a whole.
 */
export function ScrollTable({ label, minWidth, children, maxHeight }: { label: string; minWidth?: number; children: ReactNode; maxHeight?: string }) {
  return (
    <TableContainer data-fill-grow sx={{ overflow: 'auto', maxHeight, [fillMedia]: { flex: '0 1 auto', minHeight: 0 } }}>
      <Table stickyHeader size="small" aria-label={label} sx={{ minWidth }}>{children}</Table>
    </TableContainer>
  );
}
