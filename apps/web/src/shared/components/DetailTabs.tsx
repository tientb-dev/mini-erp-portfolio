import { ReactNode, useId, useState } from 'react';
import { Paper, Stack, Tab, Tabs } from '@mui/material';

export interface DetailTab {
  key: string; label: string; content: ReactNode;
  /** Feature-side condition (permission, status); hidden tabs are not rendered. */ hidden?: boolean;
}

/**
 * Tabs for a document detail. Uncontrolled by default; pass `value`/`onChange` (tab keys) to drive it from outside,
 * e.g. a route later. Only the active tab's content is mounted.
 */
export function DetailTabs({ tabs, value, onChange }: { tabs: DetailTab[]; value?: string; onChange?: (key: string) => void }) {
  const id = useId();
  const visible = tabs.filter((x) => !x.hidden);
  const [own, setOwn] = useState(visible[0]?.key);
  const wanted = value ?? own;
  const active = visible.find((x) => x.key === wanted) ?? visible[0];
  if (!active) return null;
  const select = (key: string) => { setOwn(key); onChange?.(key); };
  return (
    <Paper>
      <Tabs value={active.key} onChange={(_e, k: string) => select(k)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        {visible.map((x) => <Tab key={x.key} value={x.key} label={x.label} id={`${id}-tab-${x.key}`} aria-controls={`${id}-panel-${x.key}`} />)}
      </Tabs>
      <Stack role="tabpanel" id={`${id}-panel-${active.key}`} aria-labelledby={`${id}-tab-${active.key}`} sx={{ p: 2 }} spacing={1.5}>
        {active.content}
      </Stack>
    </Paper>
  );
}
