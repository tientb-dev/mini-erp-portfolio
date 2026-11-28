import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function ScopeChips({ scopes, focusable = true }: { scopes: string[]; focusable?: boolean }) {
  const { t } = useTranslation();
  const visible = scopes.includes('ALL') ? ['ALL'] : scopes;
  return <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
    {visible.map(scope => <Tooltip key={scope} title={t('scope.hints.' + scope)}>
      <Chip size="small" variant="outlined" tabIndex={focusable ? 0 : undefined} label={t('scope.types.' + scope)} />
    </Tooltip>)}
  </Stack>;
}

export function PermissionLabel({ code, name }: { code: string; name?: string }) {
  return <>
    <Typography variant="body2">{name ?? code}</Typography>
    {name && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{code}</Typography>}
  </>;
}
