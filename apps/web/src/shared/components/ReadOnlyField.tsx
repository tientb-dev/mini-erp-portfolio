import { TextField, TextFieldProps } from '@mui/material';
import { tokens } from '../../config/theme';

/**
 * COMMON-READONLY-001: a read-only value (View mode, or an immutable field such as a code in Edit). Background #F8FAFC,
 * text #334155, light border; selectable and copyable; never the disabled style; no required mark, dropdown or clear.
 */
export function ReadOnlyField({ value, ...props }: Pick<TextFieldProps, 'label' | 'multiline' | 'minRows' | 'id' | 'helperText'> & {
  value: string;
}) {
  return <TextField {...props} value={value || '—'} size="small" fullWidth
    slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
    sx={{ '& .MuiOutlinedInput-root': { bgcolor: tokens.surfaceAlt, color: tokens.readOnlyText },
      '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline':
        { borderColor: tokens.readOnlyBorder, borderWidth: 1 } }} />;
}
