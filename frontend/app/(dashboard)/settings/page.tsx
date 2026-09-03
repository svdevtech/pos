'use client';

import KeyIcon from '@mui/icons-material/Key';
import PeopleIcon from '@mui/icons-material/People';
import ReceiptIcon from '@mui/icons-material/Receipt';
import StorefrontIcon from '@mui/icons-material/Storefront';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useSession } from '@/components/Providers';
import { GlassCard } from '@/components/glass';
import { MUTATING_ROLES, type Role } from '@/lib/auth/session';

interface Card {
  key: 'store' | 'users' | 'password' | 'receipt';
  href: string;
  icon: ReactNode;
  roles?: readonly Role[];
}

const CARDS: Card[] = [
  { key: 'store', href: '/settings/store', icon: <StorefrontIcon />, roles: MUTATING_ROLES },
  { key: 'users', href: '/settings/users', icon: <PeopleIcon />, roles: MUTATING_ROLES },
  { key: 'password', href: '/settings/password', icon: <KeyIcon /> },
  { key: 'receipt', href: '/settings/receipt', icon: <ReceiptIcon />, roles: MUTATING_ROLES },
];

export default function SettingsPage() {
  const t = useTranslations('settings');
  const { hasRole } = useSession();

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1" fontWeight={700}>
        {t('title')}
      </Typography>
      <Grid container spacing={2}>
        {CARDS.filter((c) => !c.roles || hasRole(...c.roles)).map((card) => (
          <Grid item xs={12} sm={6} md={4} key={card.key}>
            <Link href={card.href} style={{ display: 'block', height: '100%' }}>
              <GlassCard hoverable sx={{ height: '100%' }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 3,
                      display: 'grid',
                      placeItems: 'center',
                      backgroundImage: (th) => th.glass.gradient,
                      color: '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {card.icon}
                  </Box>
                  <Box>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {t(card.key)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t(`${card.key}Desc`)}
                    </Typography>
                  </Box>
                </Stack>
              </GlassCard>
            </Link>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
