import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatDocumentAmount } from '../utils/document-money';

export function DocumentTotals({ count, currency, scale, values }: {
  count: number; currency: string; scale: number; values: [string | null, string | null, string | null];
}) {
  const { t, i18n } = useTranslation();
  return <Stack direction="row" useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, minHeight: 60, flexWrap: 'wrap', px: 1 }}>
    <Typography variant="body2">{t('prPhase.lineCount', { count })}</Typography>
    <Stack direction="row" spacing={2} sx={{ ml: 'auto', textAlign: 'right' }}>
      {(['net','taxTotal','total'] as const).map((key, index) => <Box key={key} sx={{ pl: index ? 2 : 0, borderLeft: index ? 1 : 0, borderColor: 'divider' }}>
        <Typography variant="caption">{t(`prPhase.${key}`)}</Typography>
        <Typography sx={{ fontWeight: 700, color: index === 2 ? 'primary.main' : undefined }}>
          {formatDocumentAmount(values[index], scale, i18n.language)}{index === 2 && currency ? ' ' + currency : ''}
        </Typography>
      </Box>)}
    </Stack>
  </Stack>;
}
