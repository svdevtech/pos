'use client';

import FactCheckIcon from '@mui/icons-material/FactCheck';
import ListAltIcon from '@mui/icons-material/ListAlt';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MoveDownIcon from '@mui/icons-material/MoveDown';
import TuneIcon from '@mui/icons-material/Tune';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import StatTile from '@/components/StatTile';
import { GlassCard } from '@/components/glass';
import MovementsLedger from '@/components/inventory/MovementsLedger';
import { resolveLocale } from '@/i18n/config';
import { useValuation } from '@/lib/api/hooks/inventory';
import { MUTATING_ROLES, type Role } from '@/lib/auth/session';
import { formatMoney, formatQty } from '@/lib/format';

interface Shortcut {
  key: 'stockCheck' | 'receipts' | 'adjustments' | 'conversions' | 'stockTakes' | 'movements';
  href: string;
  icon: ReactNode;
  /** The document endpoints are manager-only on the backend (handlers_inventory.go). */
  roles?: readonly Role[];
}

const SHORTCUTS: Shortcut[] = [
  { key: 'stockCheck', href: '/inventory/check', icon: <QrCodeScannerIcon /> },
  { key: 'receipts', href: '/inventory/receipts', icon: <MoveDownIcon />, roles: MUTATING_ROLES },
  { key: 'adjustments', href: '/inventory/adjustments', icon: <TuneIcon />, roles: MUTATING_ROLES },
  { key: 'conversions', href: '/inventory/conversions', icon: <SwapHorizIcon />, roles: MUTATING_ROLES },
  { key: 'stockTakes', href: '/inventory/stock-takes', icon: <FactCheckIcon />, roles: MUTATING_ROLES },
  { key: 'movements', href: '/inventory/movements', icon: <ListAltIcon /> },
];

export default function InventoryPage() {
  const t = useTranslations('inventory');
  const locale = resolveLocale(useLocale());
  const valuation = useValuation();
  const { hasRole } = useSession();
  const shortcuts = SHORTCUTS.filter((s) => !s.roles || hasRole(...s.roles));

  return (
    <Stack spacing={3}>
      <PageHeader title={t('title')} subtitle={t('valuationHint')} />
      <QueryError error={valuation.error} onRetry={() => valuation.refetch()} />

      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <StatTile label={t('units')} value={formatQty(valuation.data?.units, locale)} loading={valuation.isPending} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatTile label={t('costValue')} value={formatMoney(valuation.data?.cost_value, locale)} loading={valuation.isPending} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatTile label={t('retailValue')} value={formatMoney(valuation.data?.retail_value, locale)} loading={valuation.isPending} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        {shortcuts.map((s) => (
          <Grid item xs={12} sm={6} md={3} key={s.key}>
            <Link href={s.href} style={{ display: 'block', height: '100%', textDecoration: 'none' }}>
              <GlassCard hoverable sx={{ height: '100%', p: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: 3,
                      display: 'grid',
                      placeItems: 'center',
                      backgroundImage: (th) => th.glass.gradient,
                      color: '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {s.icon}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={600} noWrap>
                      {t(s.key)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {t(`${s.key}Desc`)}
                    </Typography>
                  </Box>
                </Stack>
              </GlassCard>
            </Link>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h6" fontWeight={600}>
        {t('movements')}
      </Typography>
      <MovementsLedger />
    </Stack>
  );
}
