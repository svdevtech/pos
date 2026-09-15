'use client';

import DashboardIcon from '@mui/icons-material/Dashboard';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import Clock from '@/components/Clock';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import RequireAuth from '@/components/RequireAuth';
import FnbTabs from '@/components/fnb/FnbTabs';
import { FnbProvider } from '@/lib/fnb/store';

/**
 * The F&B prototype shell: one thin bar to hop between the three screens, and the rest of the
 * viewport for the screen itself. Sized to the window like the retail till, for the same reason
 * — a tablet browser's chrome must not push the bottom strip off screen.
 */
function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations('fnb');
  return (
    <Box
      sx={{
        height: '100vh',
        '@supports (height: 100dvh)': { height: '100dvh' },
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <AppBar position="static">
        <Toolbar variant="dense" sx={{ gap: 1, minHeight: 52 }}>
          <Typography variant="subtitle1" component="div" noWrap sx={{ fontWeight: 800 }}>
            {t('title')}
          </Typography>
          <FnbTabs />
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Clock />
          </Box>
          <LanguageSwitcher />
          <IconButton color="inherit" component={Link} href="/dashboard" aria-label="Dashboard">
            <DashboardIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  );
}

export default function FnbLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <FnbProvider>
        <Shell>{children}</Shell>
      </FnbProvider>
    </RequireAuth>
  );
}
