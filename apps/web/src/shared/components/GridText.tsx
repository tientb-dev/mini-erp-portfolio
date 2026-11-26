import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Link, Tooltip } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const singleLine = { minWidth: 0, maxWidth: '100%', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

/** Text can shrink independently of any adjacent icon. Only clipped values get a tooltip. */
export function GridText({ value, trailing, to, onActivate, tabIndex }: {
  value: string; trailing?: ReactNode; to?: string; onActivate?: () => void; tabIndex?: number;
}) {
  const measure = useRef<HTMLElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = measure.current;
    if (!element) return;
    const check = () => setClipped(element.scrollWidth > element.clientWidth);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, to, Boolean(onActivate)]);
  const content = (
    <Tooltip title={clipped ? value : ''} describeChild>
      {to ? <Link component={RouterLink} to={to} ref={measure as React.Ref<HTMLAnchorElement>} tabIndex={tabIndex} sx={singleLine}>{value}</Link>
        : onActivate ? <Link component="button" type="button" onClick={onActivate} ref={measure as React.Ref<HTMLButtonElement>}
          tabIndex={tabIndex} sx={{ ...singleLine, textAlign: 'left' }}>{value}</Link>
          : <Box component="span" ref={measure} tabIndex={tabIndex ?? (clipped ? 0 : undefined)} sx={singleLine}>{value}</Box>}
    </Tooltip>
  );
  return trailing ? <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', '& > :nth-child(2)': { flexShrink: 0 } }}>
    {content}{trailing}
  </Box> : content;
}
