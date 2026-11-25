import { useRef } from 'react';
import { Box, IconButton, InputAdornment, TextField, Tooltip, type TextFieldProps } from '@mui/material';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete';
import Close from '@mui/icons-material/Close';
import Search from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';

function SearchStart() {
  return <InputAdornment position="start"><Search fontSize="small" sx={{ color: 'text.secondary' }} /></InputAdornment>;
}

function ClearSearch({ visible, onClear }: { visible: boolean; onClear: () => void }) {
  const { t } = useTranslation();
  return <InputAdornment position="end" sx={{ ml: 0.5 }}>
    <Box sx={{ width: 30, display: 'flex', justifyContent: 'center', visibility: visible ? 'visible' : 'hidden' }}>
      <Tooltip title={t('common.clearSearch')}>
        <IconButton type="button" size="small" aria-label={t('common.clearSearch')} tabIndex={visible ? 0 : -1}
          onMouseDown={event => event.preventDefault()} onClick={onClear}>
          <Close sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  </InputAdornment>;
}

type SearchProps = Pick<TextFieldProps, 'label' | 'placeholder' | 'sx'> & {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
};

export function SearchInput({ value, onChange, maxLength, ...props }: SearchProps) {
  const input = useRef<HTMLInputElement>(null);
  return <TextField {...props} value={value} inputRef={input} onChange={event => onChange(event.target.value)}
    slotProps={{
      inputLabel: { shrink: true },
      htmlInput: { maxLength },
      input: { startAdornment: <SearchStart />, endAdornment: <ClearSearch visible={!!value} onClear={() => {
        onChange(''); input.current?.focus();
      }} /> },
    }} />;
}

export function SearchAutocompleteInput({ params, keyword, onClear, ...props }: Pick<TextFieldProps, 'label' | 'placeholder' | 'required' | 'error'> & {
  params: AutocompleteRenderInputParams;
  keyword: string;
  onClear: () => void;
}) {
  const { input, inputLabel, htmlInput } = params.slotProps;
  return <TextField {...params} {...props} slotProps={{
    inputLabel: { ...inputLabel, shrink: true },
    htmlInput,
    input: {
      ...input,
      startAdornment: <><SearchStart />{input.startAdornment}</>,
      endAdornment: <>{!params.disabled && <ClearSearch visible={!!keyword} onClear={onClear} />}{input.endAdornment}</>,
    },
  }} sx={keyword ? { '& .MuiAutocomplete-clearIndicator': { visibility: 'hidden', pointerEvents: 'none' } } : undefined} />;
}
