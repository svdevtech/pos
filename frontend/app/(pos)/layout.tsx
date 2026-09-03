'use client';

import DashboardIcon from '@mui/icons-material/Dashboard';
import LogoutIcon from '@mui/icons-material/Logout';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import Clock from '@/components/Clock';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useSession } from '@/components/Providers';
import RequireAuth from '@/components/RequireAuth';

function PosShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const ts = useTranslations('settings');
  const locale = useLocale();
  const { session, store, logout } = useSession();

  const storeName = store ? (locale === 'en' && store.name_en ? store.name_en : store.name) : t('appName');

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar position="static">
        <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 56 }}>
          <Typography variant="h6" component="div" noWrap sx={{ fontWeight: 700 }}>
            {storeName}
          </Typography>
          {session && (
            <Chip
              size="small"
              label={`${session.user.display_name} · ${ts(`roles.${session.user.role}`)}`}
              sx={{ background: 'rgba(255,255,255,0.12)', color: 'inherit' }}
            />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Clock />
          </Box>
          <LanguageSwitcher />
          <Tooltip title={t('dashboard')}>
            <IconButton color="inherit" component={Link} href="/dashboard" aria-label={t('dashboard')}>
              <DashboardIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('logout')}>
            <IconButton color="inherit" onClick={() => void logout()} aria-label={t('logout')}>
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.5, md: 2 } }}>
        {children}
      </Box>
    </Box>
  );
}

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <PosShell>{children}</PosShell>
    </RequireAuth>
  );
}
