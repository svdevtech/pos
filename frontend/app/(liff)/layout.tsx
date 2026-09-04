'use client';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';
import AppFooter from '@/components/AppFooter';
import { BACKGROUND_LIGHT, lightGlassTheme } from '@/lib/theme/glassTheme';

/** Mobile-first light glass shell for LINE LIFF pages (no auth guard; LIFF has its own identity). */
export default function LiffLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={lightGlassTheme}>
      <Box
        sx={{
          minHeight: '100vh',
          background: BACKGROUND_LIGHT,
          color: 'text.primary',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Container maxWidth="sm" disableGutters sx={{ flex: 1, px: 2, py: 2 }}>
          {children}
        </Container>
        <AppFooter />
      </Box>
    </ThemeProvider>
  );
}
