import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs, Link, Typography } from '@mui/material';

/** Path above the title. Items with `to` are links; the last item is the current page. The feature passes only allowed routes. */
export function PageBreadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  const { t } = useTranslation();
  return (
    <Breadcrumbs aria-label={t('common.breadcrumbs')} sx={{ fontSize: 14 }}>
      {items.map((x, i) => (x.to && i < items.length - 1
        ? <Link key={i} component={RouterLink} to={x.to} underline="hover" color="inherit">{x.label}</Link>
        : <Typography key={i} variant="body2" color={i === items.length - 1 ? 'text.primary' : 'text.secondary'} aria-current={i === items.length - 1 ? 'page' : undefined}>{x.label}</Typography>
      ))}
    </Breadcrumbs>
  );
}
