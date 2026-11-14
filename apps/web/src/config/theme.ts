import { createTheme, type Theme } from '@mui/material';
import { enUS as coreEn, viVN as coreVi } from '@mui/material/locale';
import { enUS as gridEn, viVN as gridVi } from '@mui/x-data-grid/locales';

/** Design tokens for the Mini ERP back-office UI. */
export const tokens = {
  canvas: '#F2F4F3',
  surface: '#FFFFFF',
  ink: '#1E2A32',
  inkMuted: '#5B6870',
  border: '#D5DCDA',
  primary: '#1D5C6B',
  sidebarWidth: 232,
};

/** Tones used by status chips; one meaning per tone across all documents. */
export const statusTones = {
  neutral: { fg: '#4A5560', bg: '#E8ECEB' },
  pending: { fg: '#8A5A00', bg: '#FCEFD4' },
  success: { fg: '#24693F', bg: '#DDF0E3' },
  danger: { fg: '#A61B1B', bg: '#FBE2E0' },
  muted: { fg: '#7A858C', bg: '#F0F2F2' },
} as const;
export type StatusTone = keyof typeof statusTones;

function build(locale: 'vi' | 'en'): Theme {
  return createTheme(
    {
      palette: {
        primary: { main: tokens.primary },
        background: { default: tokens.canvas, paper: tokens.surface },
        text: { primary: tokens.ink, secondary: tokens.inkMuted },
        divider: tokens.border,
      },
      shape: { borderRadius: 6 },
      typography: {
        fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
        fontSize: 14,
        h1: { fontSize: '1.375rem', fontWeight: 600, lineHeight: 1.3 },
        h2: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.35 },
        body2: { fontSize: '0.8125rem' },
        button: { textTransform: 'none', fontWeight: 600 },
      },
      components: {
        MuiButton: { defaultProps: { disableElevation: true } },
        MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
        MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: `1px solid ${tokens.border}` } } },
        MuiAppBar: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: 0, borderBottom: `1px solid ${tokens.border}` } } },
        MuiDialog: { styleOverrides: { paper: { border: 0 } } },
        MuiDrawer: { styleOverrides: { paper: { border: 0, borderRight: `1px solid ${tokens.border}` } } },
        MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': { outline: `2px solid ${tokens.primary}`, outlineOffset: 2 } } } },
      },
    },
    locale === 'vi' ? coreVi : coreEn,
    locale === 'vi' ? gridVi : gridEn,
  );
}

export const themes = { vi: build('vi'), en: build('en') };
