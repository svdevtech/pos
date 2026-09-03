'use client';

import { createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';

export interface GlassTokens {
  /** Translucent surface background used by Paper/Card/Dialog. */
  surface: string;
  /** Slightly stronger surface for hover / elevated elements. */
  surfaceStrong: string;
  /** Border color for glass surfaces. */
  border: string;
  /** Backdrop blur applied to glass surfaces. */
  blur: string;
  /** Primary → secondary accent gradient. */
  gradient: string;
  /** Page background gradient. */
  background: string;
  /** Border radius (px) for glass surfaces. */
  radius: number;
}

declare module '@mui/material/styles' {
  interface Theme {
    glass: GlassTokens;
  }
  interface ThemeOptions {
    glass?: GlassTokens;
  }
}

export const FONT_FAMILY =
  "var(--font-sarabun), var(--font-noto-sans-thai), 'Sarabun', 'Noto Sans Thai', Roboto, sans-serif";

export const ACCENT_GRADIENT = 'linear-gradient(135deg, #1E88E5 0%, #7C4DFF 100%)';
export const BACKGROUND_DARK = 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)';
export const BACKGROUND_LIGHT = 'linear-gradient(135deg, #e3f2fd 0%, #ede7f6 50%, #e8eaf6 100%)';

export const glassTokens: Record<PaletteMode, GlassTokens> = {
  dark: {
    surface: 'rgba(255, 255, 255, 0.12)',
    surfaceStrong: 'rgba(255, 255, 255, 0.18)',
    border: 'rgba(255, 255, 255, 0.25)',
    blur: 'blur(16px)',
    gradient: ACCENT_GRADIENT,
    background: BACKGROUND_DARK,
    radius: 16,
  },
  light: {
    surface: 'rgba(255, 255, 255, 0.55)',
    surfaceStrong: 'rgba(255, 255, 255, 0.75)',
    border: 'rgba(255, 255, 255, 0.7)',
    blur: 'blur(16px)',
    gradient: ACCENT_GRADIENT,
    background: BACKGROUND_LIGHT,
    radius: 16,
  },
};

export function createGlassTheme(mode: PaletteMode = 'dark'): Theme {
  const glass = glassTokens[mode];
  const isDark = mode === 'dark';

  const glassSurface = {
    background: glass.surface,
    backdropFilter: glass.blur,
    WebkitBackdropFilter: glass.blur,
    border: `1px solid ${glass.border}`,
    borderRadius: glass.radius,
    boxShadow: isDark ? '0 8px 32px rgba(0, 0, 0, 0.25)' : '0 8px 32px rgba(31, 38, 135, 0.12)',
    backgroundImage: 'none',
  } as const;

  const options: ThemeOptions = {
    glass,
    palette: {
      mode,
      primary: { main: '#1E88E5', light: '#6AB7FF', dark: '#005CB2', contrastText: '#ffffff' },
      secondary: { main: '#7C4DFF', light: '#B47CFF', dark: '#3F1DCB', contrastText: '#ffffff' },
      success: { main: '#43A047' },
      warning: { main: '#FB8C00' },
      error: { main: '#E53935' },
      background: {
        default: isDark ? '#16303b' : '#eef2fb',
        paper: glass.surface,
      },
      text: isDark
        ? { primary: '#ffffff', secondary: 'rgba(255, 255, 255, 0.72)' }
        : { primary: '#14213d', secondary: 'rgba(20, 33, 61, 0.68)' },
      divider: glass.border,
    },
    shape: { borderRadius: glass.radius },
    typography: {
      fontFamily: FONT_FAMILY,
      h1: { fontWeight: 700 },
      h2: { fontWeight: 700 },
      h3: { fontWeight: 600 },
      h4: { fontWeight: 600 },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { height: '100%' },
          body: {
            minHeight: '100vh',
            background: glass.background,
            backgroundAttachment: 'fixed',
          },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-thumb': {
            background: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
            borderRadius: 8,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: glassSurface },
      },
      MuiCard: {
        styleOverrides: { root: glassSurface },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { ...glassSurface, background: isDark ? 'rgba(30, 45, 60, 0.85)' : 'rgba(255,255,255,0.9)' },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'transparent' },
        styleOverrides: {
          root: {
            background: glass.surface,
            backdropFilter: glass.blur,
            WebkitBackdropFilter: glass.blur,
            borderBottom: `1px solid ${glass.border}`,
            borderRadius: 0,
            color: isDark ? '#fff' : '#14213d',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            background: isDark ? 'rgba(15, 32, 39, 0.75)' : 'rgba(255,255,255,0.6)',
            backdropFilter: glass.blur,
            WebkitBackdropFilter: glass.blur,
            borderRight: `1px solid ${glass.border}`,
            borderRadius: 0,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { ...glassSurface, background: isDark ? 'rgba(30, 45, 60, 0.92)' : 'rgba(255,255,255,0.95)' },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: { background: isDark ? 'rgba(30, 45, 60, 0.92)' : 'rgba(255,255,255,0.95)' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 12, paddingInline: 20 },
          containedPrimary: {
            backgroundImage: glass.gradient,
            '&:hover': { backgroundImage: glass.gradient, filter: 'brightness(1.08)' },
            '&.Mui-disabled': { backgroundImage: 'none' },
          },
          outlined: {
            borderColor: glass.border,
            background: 'rgba(255,255,255,0.06)',
            '&:hover': { background: glass.surfaceStrong, borderColor: glass.border },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: glass.border },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(30,136,229,0.5)',
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottom: `1px solid ${glass.border}` },
          head: {
            fontWeight: 600,
            background: isDark ? 'rgba(20, 40, 55, 0.95)' : 'rgba(240, 244, 255, 0.98)',
            backdropFilter: glass.blur,
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: glass.border,
            color: 'inherit',
            '&.Mui-selected': {
              backgroundImage: glass.gradient,
              color: '#fff',
              '&:hover': { backgroundImage: glass.gradient, filter: 'brightness(1.08)' },
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: 8 } },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            marginInline: 8,
            '&.Mui-selected': {
              backgroundImage: glass.gradient,
              color: '#fff',
              '& .MuiListItemIcon-root': { color: '#fff' },
              '&:hover': { backgroundImage: glass.gradient, filter: 'brightness(1.08)' },
            },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { fontSize: 13 } },
      },
    },
  };

  return createTheme(options);
}

export const darkGlassTheme = createGlassTheme('dark');
export const lightGlassTheme = createGlassTheme('light');
export const glassTheme = darkGlassTheme;
