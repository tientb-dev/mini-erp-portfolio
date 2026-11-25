import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatDocumentAmount } from '../utils/document-money';

export function DocumentTotals({ count, currency, scale, values }: {
  count: number; currency: string; scale: number; values: [string | null, string | null, string | null];
}) {
  const { t, i18n } = useTranslation();
  return <Stack direction="row" useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, minHeight: 60, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
    <Typography variant="body2">{t('prPhase.lineCount', { count })}</Typography>
    <Stack direction="row" spacing={{ xs: 1, md: 2.5 }} sx={{ ml: 'auto', textAlign: 'right', maxWidth: '100%', overflowX: 'auto', whiteSpace: 'nowrap' }}>
      {(['net','taxTotal','total'] as const).map((key, index) => <Box key={key} sx={{ pl: index ? { xs: 1, md: 2.5 } : 0, borderLeft: index ? 1 : 0, borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ fontSize: 12 }}>{t(`prPhase.${key}`)}</Typography>
        <Typography sx={{ fontWeight: 700, fontSize: index === 2 ? 18 : 16, color: index === 2 ? 'primary.main' : undefined }}>
          {formatDocumentAmount(values[index], scale, i18n.language)}{index === 2 && currency ? ' ' + currency : ''}
        </Typography>
      </Box>)}
    </Stack>
  </Stack>;
}
