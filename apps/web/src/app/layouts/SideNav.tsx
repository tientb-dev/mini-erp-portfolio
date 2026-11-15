import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { tokens } from '../../config/theme';
import { pagePath } from '../../shared/navigation';
import { NAV, PageKey, PAGES } from '../routes';

const STORAGE_KEY = 'mini-erp.nav.collapsed';

// Per-browser convenience: storage may be blocked (private mode), so failures fall back to "all open".
function readCollapsed(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}
function writeCollapsed(groups: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups)); } catch { /* not persisted */ }
}

/**
 * Parent groups with their allowed children only; a group without allowed children is hidden. Every group starts
 * expanded; the user's collapse choice is remembered, and the group holding the current page re-opens on navigation.
 */
export function SideNav({ active, allowed, onNavigate }: { active: PageKey | null; allowed: (k: PageKey) => boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const activeGroup = NAV.find((g) => active && g.items.includes(active))?.group;
  const save = (next: string[]) => { setCollapsed(next); writeCollapsed(next); };

  // Navigating to a page inside a collapsed group opens that group so the current page is visible.
  useEffect(() => {
    if (!activeGroup) return;
    setCollapsed((c) => {
      if (!c.includes(activeGroup)) return c;
      const next = c.filter((g) => g !== activeGroup);
      writeCollapsed(next);
      return next;
    });
  }, [activeGroup, active]);

  return (
    <Box component="nav" aria-label={t('nav.label')} sx={{ width: tokens.sidebarWidth, py: 1, overflowY: 'auto' }}>
      <List dense disablePadding>
        {NAV.map(({ group, icon: GroupIcon, items }) => {
          const visible = items.filter(allowed);
          if (!visible.length) return null;
          const open = !collapsed.includes(group);
          const id = `nav-${group}`;
          return (
            <Box component="li" key={group} sx={{ listStyle: 'none' }}>
              <ListItemButton
                aria-expanded={open}
                aria-controls={id}
                onClick={() => save(open ? [...collapsed, group] : collapsed.filter((g) => g !== group))}
                sx={{ mx: 1, color: group === activeGroup ? 'primary.main' : 'text.secondary' }}
              >
                <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}><GroupIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t(group)} slotProps={{ primary: { sx: { fontWeight: 600, fontSize: 13 } } }} />
                {open ? <ExpandLess fontSize="small" aria-hidden /> : <ExpandMore fontSize="small" aria-hidden />}
              </ListItemButton>
              {open && (
                <List id={id} dense disablePadding>
                  {visible.map((k) => {
                    const ItemIcon = PAGES[k][2];
                    return (
                      <ListItemButton
                        key={k}
                        component={RouterLink}
                        to={pagePath(k)}
                        selected={k === active}
                        aria-current={k === active ? 'page' : undefined}
                        onClick={onNavigate}
                        sx={{ mx: 1, pl: 3, '&.Mui-selected': { fontWeight: 600 } }}
                      >
                        <ListItemIcon sx={{ minWidth: 30, color: 'inherit' }}><ItemIcon sx={{ fontSize: 18 }} /></ListItemIcon>
                        <ListItemText primary={t(`nav.${k}`)} slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
                      </ListItemButton>
                    );
                  })}
                </List>
              )}
            </Box>
          );
        })}
      </List>
    </Box>
  );
}
