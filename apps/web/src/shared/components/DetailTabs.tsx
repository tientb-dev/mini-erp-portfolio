import { ReactNode, useId, useState } from 'react';
import { fillMedia } from '../../config/theme';
import { Paper, Stack, Tab, Tabs } from '@mui/material';

export interface DetailTab {
  key: string; label: string; content: ReactNode; invalid?: boolean;
  /** Feature-side condition (permission, status); hidden tabs are not rendered. */ hidden?: boolean;
}

/**
 * Tabs for a document detail. Uncontrolled by default; pass `value`/`onChange` (tab keys) to drive it from outside,
 * e.g. a route later. Only the active tab's content is mounted.
 */
export function DetailTabs({ tabs, value, onChange, below }: {
  tabs: DetailTab[]; value?: string; onChange?: (key: string) => void; below?: ReactNode;
}) {
  const id = useId();
  const visible = tabs.filter((x) => !x.hidden);
  const [own, setOwn] = useState(visible[0]?.key);
  const wanted = value ?? own;
  const active = visible.find((x) => x.key === wanted) ?? visible[0];
  if (!active) return null;
  const select = (key: string) => { setOwn(key); onChange?.(key); };
  return (
    // data-fill-grow: on fill screens the tab box takes the remaining height and its panel's table scrolls inside.
    <Paper data-fill-grow sx={{ [fillMedia]: { display: 'flex', flexDirection: 'column', flex: '0 1 auto', minHeight: 0 } }}>
      <Tabs value={active.key} onChange={(_e, k: string) => select(k)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        {visible.map((x) => <Tab key={x.key} value={x.key} label={x.invalid ? `${x.label} *` : x.label}
          aria-invalid={x.invalid || undefined} sx={x.invalid ? { color: 'error.main', '&.Mui-selected': { color: 'error.main' } } : undefined}
          id={`${id}-tab-${x.key}`} aria-controls={`${id}-panel-${x.key}`} />)}
      </Tabs>
      <Stack role="tabpanel" id={`${id}-panel-${active.key}`} aria-labelledby={`${id}-tab-${active.key}`} spacing={1.5}
        sx={{ p: 2, [fillMedia]: { flex: '0 1 auto', minHeight: 0, '& > :not([data-fill-grow])': { flexShrink: 0 } } }}>
        {active.content}
      </Stack>
      {below}
    </Paper>
  );
}
