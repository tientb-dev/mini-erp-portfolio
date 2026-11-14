import { useTranslation } from 'react-i18next';
import { Alert } from '@mui/material';

/** Shows the API Problem Details message; tells the user what to do next. */
export function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  // Known business codes have their own message; anything else shows the API detail.
  const { code, message } = error as { code?: string; message: string };
  const detail = code ? t(`errors.${code}`, { defaultValue: message }) : message;
  return <Alert severity="error">{t('common.error', { detail })}</Alert>;
}
