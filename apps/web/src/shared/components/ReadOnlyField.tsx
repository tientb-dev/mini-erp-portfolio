import { TextField, TextFieldProps } from '@mui/material';
import { tokens } from '../../config/theme';

export function ReadOnlyField({ value, ...props }: Pick<TextFieldProps, 'label' | 'multiline' | 'minRows' | 'id'> & {
  value: string;
}) {
  return <TextField {...props} value={value || '—'} size="small" fullWidth
    slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
    sx={{ '& .MuiOutlinedInput-root': { bgcolor: tokens.surfaceAlt, color: tokens.readOnlyInk },
      '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.readOnlyBorder } }} />;
}
