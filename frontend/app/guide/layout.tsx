'use client';

import LoginIcon from '@mui/icons-material/Login';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { GlassButton } from '@/components/glass';

/** The manual is public: anyone handed the address can read it without an account. */
export default function GuideLayout({ children }: { children: ReactNode }) {
  const tc = useTranslations('common');
  const ta = useTranslations('auth');

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" color="transparent" elevation={0} className="no-print" sx={{ backdropFilter: 'blur(12px)', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1.5 }}>
          <MenuBookIcon />
          <Typography variant="h6" fontWeight={700} noWrap sx={{ flex: 1 }}>
            {tc('appName')}
          </Typography>
          <LanguageSwitcher />
          <GlassButton component={Link} href="/login" size="small" startIcon={<LoginIcon />}>
            {ta('signIn')}
          </GlassButton>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ flex: 1, py: 3 }}>
        {children}
      </Container>
    </Box>
  );
}
