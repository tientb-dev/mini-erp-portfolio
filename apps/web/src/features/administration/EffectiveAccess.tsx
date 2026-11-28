import { Fragment, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api-client';
import { ErrorAlert } from '../../shared/components/ErrorAlert';
import { FilterToolbar } from '../../shared/components/FilterToolbar';
import { SearchInput } from '../../shared/components/SearchInput';
import { PermissionLabel, ScopeChips } from './scope-labels';
import { USERS } from './users-api';

interface OrgUnit { id: number; code: string; name: string; parentId: number | null }
interface EffectiveAccessSnapshot {
  grants: Record<string, string[] | null>;
  permissionModules: Record<string, string>;
  permissionNames: Record<string, string>;
  sources: Record<string, { roleId: number; roleCode: string; roleName: string; scopes: string[] }[]>;
  orgUnitIds: number[];
  orgUnits: OrgUnit[];
}

export const effectiveAccessKey = [USERS, 'effective-access'] as const;

function UnitTree({ units, parent = null }: { units: OrgUnit[]; parent?: number | null }) {
  const children = units.filter(unit => parent === null ? !units.some(other => other.id === unit.parentId) : unit.parentId === parent);
  if (!children.length) return null;
  return <Box component="ul" sx={{ my: 0, pl: 2.5 }}>
    {children.map(unit => <Box component="li" key={unit.id}>
      <Typography variant="body2">{unit.code} · {unit.name}</Typography>
      <UnitTree units={units} parent={unit.id} />
    </Box>)}
  </Box>;
}

export function EffectiveAccess({ id, pending }: { id: number; pending: boolean }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<string[]>([]);
  const access = useQuery({ queryKey: [...effectiveAccessKey, id], enabled: id > 0,
    queryFn: () => api<EffectiveAccessSnapshot>(USERS + '/' + id + '/effective-access') });
  if (!id) return <Alert severity="info">{t('scope.newUser')}</Alert>;
  if (access.error) return <ErrorAlert error={access.error} />;
  if (!access.data) return <Typography>{t('common.loading')}</Typography>;
  const { grants, sources, orgUnitIds, orgUnits, permissionModules, permissionNames } = access.data;
  const missing = (code: string) => grants[code] !== null && sources[code].some(role => !role.scopes.length);
  const needle = search.trim().toLocaleLowerCase();
  const codes = Object.keys(grants).sort().filter(code =>
    (code.toLocaleLowerCase().includes(needle) || permissionNames[code]?.toLocaleLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'scoped' ? grants[code] !== null : missing(code))));
  const modules = [...new Set(codes.map(code => permissionModules[code]))];
  return <Stack spacing={1.5}>
    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('scope.saved')}</Typography>
    {pending && <Alert severity="info">{t('scope.pending')}</Alert>}
    <Typography variant="body2" color="text.secondary">{t('scope.union')}</Typography>
    <FilterToolbar>
      <SearchInput label={t('common.search')} placeholder={t('roles.permissionSearch')} value={search} onChange={setSearch} sx={{ flex: '1 1 260px', maxWidth: 420 }} />
      <TextField select size="small" sx={{ width: { xs: '100%', sm: 255 } }} label={t('scope.filter')} value={filter} onChange={event => setFilter(event.target.value)}>
        <MenuItem value="all">{t('scope.allPermissions')}</MenuItem>
        <MenuItem value="scoped">{t('scope.scopedPermissions')}</MenuItem>
        <MenuItem value="missing">{t('scope.missing')}</MenuItem>
      </TextField>
    </FilterToolbar>
    {!codes.length && <Typography color="text.secondary">{t(Object.keys(grants).length ? 'scope.emptyFilter' : 'scope.empty')}</Typography>}
    {modules.map(module => {
      const rows = codes.filter(code => permissionModules[code] === module);
      return <Accordion key={module} variant="outlined" disableGutters defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography sx={{ fontWeight: 600 }}>{t('roles.modules.' + module, { defaultValue: module })}</Typography>
            <Typography variant="body2" color="text.secondary">{t('scope.permissionCount', { count: rows.length })}</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0 }}>
          <TableContainer><Table size="small" aria-label={t('roles.modules.' + module, { defaultValue: module })}>
            <TableHead><TableRow>
              <TableCell sx={{ width: '40%' }}>{t('scope.functional')}</TableCell>
              <TableCell sx={{ width: '40%' }}>{t('scope.effective')}</TableCell>
              <TableCell>{t('scope.source')}</TableCell>
            </TableRow></TableHead>
            <TableBody>{rows.map(code => {
              const scopes = grants[code];
              const open = expanded.includes(code);
              const roles = sources[code];
              const label = t('scope.details', { code });
              const units = scopes?.includes('ALL') ? [] : orgUnits.filter(unit =>
                scopes?.includes('ORG_UNIT_TREE') || (scopes?.includes('ORG_UNIT') && orgUnitIds.includes(unit.id)));
              return <Fragment key={code}>
                <TableRow>
                  <TableCell component="th" scope="row"><Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <IconButton size="small" aria-label={label} aria-expanded={open} onClick={() =>
                      setExpanded(previous => open ? previous.filter(item => item !== code) : [...previous, code])}>
                      <ExpandMore sx={{ transform: open ? 'rotate(180deg)' : undefined }} />
                    </IconButton>
                    <Box><PermissionLabel code={code} name={permissionNames[code]} /></Box>
                  </Stack></TableCell>
                  <TableCell>{scopes?.length ? <ScopeChips scopes={scopes} /> : t(scopes === null ? 'scope.unscoped' : 'scope.missing')}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{t('scope.roleCount', { count: roles.length })}</Typography>
                    {missing(code) && <Typography variant="caption" sx={{ color: 'warning.dark' }}>{t('scope.missing')}</Typography>}
                  </TableCell>
                </TableRow>
                {open && <TableRow><TableCell colSpan={3} sx={{ bgcolor: 'action.hover' }}>
                  <Stack spacing={1} role="region" aria-label={label}>
                    {roles.map(role => <Stack key={role.roleId} spacing={0.5}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{role.roleCode} · {role.roleName}</Typography>
                      {role.scopes.length ? <ScopeChips scopes={role.scopes} />
                        : <Typography variant="body2" sx={{ color: scopes === null ? 'text.secondary' : 'warning.dark' }}>
                          {scopes === null ? t('scope.unscoped') : t('scope.missing') + ' · ' + t('scope.missingGrant')}
                        </Typography>}
                    </Stack>)}
                    {units.length > 0 && <Box>
                      <Typography variant="subtitle2">{t('scope.units')}</Typography>
                      <UnitTree units={units} />
                    </Box>}
                  </Stack>
                </TableCell></TableRow>}
              </Fragment>;
            })}</TableBody>
          </Table></TableContainer>
        </AccordionDetails>
      </Accordion>;
    })}
  </Stack>;
}
