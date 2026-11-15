import { alpha, createTheme, type Theme } from '@mui/material';
import { enUS as coreEn, viVN as coreVi } from '@mui/material/locale';
import { enUS as gridEn, viVN as gridVi } from '@mui/x-data-grid/locales';
import type {} from '@mui/x-data-grid/themeAugmentation';

/**
 * Design tokens of the Mini ERP back office ("Hồ sơ chứng từ": quiet surfaces, one blue for actions and navigation,
 * status colours kept for business meaning). Components read them through the MUI theme, not directly.
 */
export const tokens = {
  primary: '#1F5FC4',
  primaryHover: '#184DA3',
  primarySoft: '#EAF1FC',
  canvas: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  ink: '#18222F',
  inkMuted: '#5A6878',
  border: '#DCE2E9',
  borderStrong: '#B9C3CF',
  sidebarWidth: 240,
  /** Control heights: desktop 36 (buttons) / 40 (inputs); touch targets at least 44. */
  control: 36,
  input: 40,
  touch: 44,
};

/**
 * Screens tall and wide enough for "fill" pages: a page marked `data-fill-page` takes exactly the main area, its header,
 * tabs and footer stay put and only its data region (`data-fill-grow`, e.g. ScrollTable) scrolls. Smaller screens scroll
 * the main area as a whole (no nested scrolling on phones).
 */
export const fillMedia = '@media (min-width: 600px) and (min-height: 700px)';

/** Tones used by status chips; one meaning per tone across all documents (03 §6). */
export const statusTones = {
  neutral: { fg: '#475467', bg: '#EEF1F5' }, // Nháp
  pending: { fg: '#8A5300', bg: '#FFF1D6' }, // Chờ duyệt / chờ xác nhận
  success: { fg: '#1F6B3F', bg: '#E3F3E8' }, // Đã chốt / Đã duyệt
  danger: { fg: '#B42318', bg: '#FDE7E5' }, // Bị từ chối / lỗi
  muted: { fg: '#6B7685', bg: '#F2F4F7' }, // Đã hủy
} as const;
export type StatusTone = keyof typeof statusTones;

const coarse = '@media (pointer: coarse)';

function build(locale: 'vi' | 'en'): Theme {
  const displayedRows = ({ from, to, count }: { from: number; to: number; count: number }) =>
    locale === 'vi' ? `${from}–${to} trên ${count !== -1 ? count : `hơn ${to}`}` : `${from}–${to} of ${count !== -1 ? count : `more than ${to}`}`;
  const theme = createTheme(
    {
      palette: {
        primary: { main: tokens.primary, dark: tokens.primaryHover, light: tokens.primarySoft, contrastText: '#FFFFFF' },
        error: { main: '#C4320A' },
        warning: { main: '#B26A00' },
        success: { main: '#2E7D4F' },
        background: { default: tokens.canvas, paper: tokens.surface },
        text: { primary: tokens.ink, secondary: tokens.inkMuted },
        divider: tokens.border,
        action: { hover: alpha(tokens.primary, 0.05), selected: alpha(tokens.primary, 0.1) },
      },
      shape: { borderRadius: 6 },
      typography: {
        fontFamily: '"Be Vietnam Pro", system-ui, "Segoe UI", sans-serif',
        fontSize: 14,
        h1: { fontSize: '1.375rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' },
        h2: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
        body1: { fontSize: '0.875rem', lineHeight: 1.55 },
        body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
        caption: { fontSize: '0.75rem', lineHeight: 1.45 },
        button: { textTransform: 'none', fontWeight: 600, fontSize: '0.875rem', letterSpacing: 0 },
      },
      components: {
        MuiCssBaseline: { styleOverrides: { body: { WebkitFontSmoothing: 'antialiased' } } },
        MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': { outline: `2px solid ${tokens.primary}`, outlineOffset: 2 } } } },
        MuiButton: {
          defaultProps: { disableElevation: true },
          // Neutral border for the primary outlined button only; coloured ones (error) keep their colour.
          variants: [{ props: { variant: 'outlined', color: 'primary' }, style: { borderColor: tokens.borderStrong, '&:hover': { borderColor: tokens.primary } } }],
          styleOverrides: {
            root: { minHeight: tokens.control, borderRadius: 6, paddingInline: 14, [coarse]: { minHeight: tokens.touch } },
            sizeSmall: { minHeight: 30, paddingInline: 10 },
            startIcon: { marginRight: 6, '& > *:nth-of-type(1)': { fontSize: 18 } },
          },
        },
        MuiIconButton: {
          styleOverrides: {
            root: { borderRadius: 6 },
            sizeSmall: { padding: 6, [coarse]: { minWidth: tokens.touch, minHeight: tokens.touch } },
          },
        },
        // Forms: labels always above the field (never inside the border), 40px inputs, one rule for every TextField/Select.
        MuiTextField: { defaultProps: { size: 'small', fullWidth: true, slotProps: { inputLabel: { shrink: true } } } },
        MuiOutlinedInput: {
          defaultProps: { notched: false },
          styleOverrides: {
            root: {
              backgroundColor: tokens.surface,
              minHeight: tokens.input,
              '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.border, top: 0, '& legend': { display: 'none' } },
              '&:hover:not(.Mui-disabled, .Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: tokens.borderStrong },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1.5 },
              '&.Mui-disabled': { backgroundColor: tokens.surfaceAlt },
            },
            input: { paddingBlock: 9.5, paddingInline: 12 },
            multiline: { paddingBlock: 9.5, paddingInline: 12 },
          },
        },
        MuiInputLabel: {
          styleOverrides: {
            outlined: {
              '&.MuiInputLabel-shrink': {
                position: 'static', transform: 'none', marginBottom: 6, maxWidth: '100%',
                fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.4, color: tokens.ink,
              },
              '&.Mui-focused': { color: tokens.ink },
              '&.Mui-error': { color: '#C4320A' },
              '& .MuiFormLabel-asterisk': { color: '#C4320A' },
            },
          },
        },
        MuiFormHelperText: { styleOverrides: { root: { marginInline: 0, marginTop: 4, fontSize: '0.75rem' } } },
        MuiMenuItem: { styleOverrides: { root: { fontSize: '0.875rem', minHeight: 36 } } },
        MuiChip: { styleOverrides: { root: { borderRadius: 6, height: 24, fontWeight: 600, fontSize: '0.75rem' }, label: { paddingInline: 8 } } },
        MuiTabs: { styleOverrides: { root: { minHeight: tokens.touch }, indicator: { height: 2 } } },
        MuiTab: {
          styleOverrides: {
            root: { minHeight: tokens.touch, paddingInline: 16, fontWeight: 600, fontSize: '0.875rem', color: tokens.inkMuted, '&.Mui-selected': { color: tokens.primary } },
          },
        },
        MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: `1px solid ${tokens.border}` } } },
        MuiAppBar: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: 0, borderBottom: `1px solid ${tokens.border}` } } },
        MuiDrawer: { styleOverrides: { paper: { border: 0, borderRight: `1px solid ${tokens.border}` } } },
        MuiMenu: { styleOverrides: { paper: { border: `1px solid ${tokens.border}`, boxShadow: '0 4px 16px rgba(24, 34, 47, 0.08)' } } },
        MuiPopover: { styleOverrides: { paper: { border: `1px solid ${tokens.border}` } } },
        MuiDialog: { styleOverrides: { paper: { border: 0, borderRadius: 10 } } },
        MuiDialogTitle: { styleOverrides: { root: { padding: '20px 24px 0', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 } } },
        MuiDialogContent: { styleOverrides: { root: { padding: '16px 24px 24px' } } },
        MuiDialogActions: { styleOverrides: { root: { padding: '12px 24px', gap: 8, borderTop: `1px solid ${tokens.border}`, '& > :not(style) ~ :not(style)': { marginLeft: 0 } } } },
        MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: tokens.ink, fontSize: '0.75rem', fontWeight: 500 } } },
        MuiLink: { defaultProps: { underline: 'hover' }, styleOverrides: { root: { fontWeight: 500 } } },
        MuiBreadcrumbs: { styleOverrides: { root: { fontSize: '0.8125rem' }, separator: { color: tokens.borderStrong } } },
        MuiTableCell: {
          styleOverrides: {
            root: { fontSize: '0.875rem', borderColor: tokens.border, paddingBlock: 10, paddingInline: 12 },
            head: { fontSize: '0.8125rem', fontWeight: 600, color: tokens.inkMuted, backgroundColor: tokens.surfaceAlt, whiteSpace: 'nowrap' },
          },
        },
        MuiDataGrid: {
          defaultProps: { rowHeight: tokens.touch, columnHeaderHeight: 40 },
          styleOverrides: {
            root: { border: 0, fontSize: '0.875rem', '--DataGrid-containerBackground': tokens.surfaceAlt, '--DataGrid-rowBorderColor': tokens.border },
            columnHeaderTitle: { fontSize: '0.8125rem', fontWeight: 600, color: tokens.inkMuted },
            cell: { '&:focus, &:focus-within': { outline: 'none' } },
            row: { '&:focus-within': { boxShadow: `inset 2px 0 0 ${tokens.primary}` } },
          },
        },
        MuiListItemButton: {
          styleOverrides: {
            root: {
              borderRadius: 6,
              '&.Mui-selected': { backgroundColor: tokens.primarySoft, color: tokens.primary, '&:hover': { backgroundColor: tokens.primarySoft } },
            },
          },
        },
      },
    },
    locale === 'vi' ? coreVi : coreEn,
    locale === 'vi' ? gridVi : gridEn,
  );
  // The locale packs come last and lack "x–y of n" in Vietnamese: set it on both paginations after they merge.
  const grid = theme.components!.MuiDataGrid!.defaultProps!;
  grid.localeText = { ...grid.localeText, paginationDisplayedRows: displayedRows };
  theme.components!.MuiTablePagination = { ...theme.components!.MuiTablePagination, defaultProps: { ...theme.components!.MuiTablePagination?.defaultProps, labelDisplayedRows: displayedRows } };
  return theme;
}

export const themes = { vi: build('vi'), en: build('en') };
