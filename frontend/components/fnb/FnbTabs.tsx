'use client';

/**
 * The three-screen switcher for the F&B shell.
 *
 * In its own file on purpose: TypeScript sizes MUI's polymorphic prop unions per file, and with
 * this strip inside the layout the layout tipped over the limit (TS2590) no matter which element
 * the strip was built from.
 */

import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import SettingsIcon from '@mui/icons-material/Settings';
import TableRestaurantIcon from '@mui/icons-material/TableRestaurant';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/components/Providers';
import { MUTATING_ROLES } from '@/lib/auth/session';

/**
 * A tab is a plain next/link with a Box for layout — no MUI button at all. Every attempt to build
 * this strip on a polymorphic Button/Chip with component={Link} plus an icon tripped TS2590,
 * whichever prop was moved or pinned; an anchor carries no prop union for tsc to size.
 */
function Tab({ href, active, testId, icon, label }: { href: string; active: boolean; testId: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }} data-testid={testId}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 0.6,
          borderRadius: 1.5,
          fontSize: 14,
          fontWeight: active ? 800 : 600,
          bgcolor: active ? 'rgba(255,255,255,0.22)' : 'transparent',
          transition: 'background .15s',
          whiteSpace: 'nowrap',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.14)' },
        }}
      >
        {icon}
        {label}
      </Box>
    </Link>
  );
}

export default function FnbTabs() {
  const t = useTranslations('fnb');
  const path = usePathname() ?? '';
  const { hasRole } = useSession();
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexGrow: 1, overflowX: 'auto' }}>
      <Tab href="/fnb/order" active={path.startsWith('/fnb/order')} testId="fnb-tab-order" icon={<LocalCafeIcon fontSize="small" />} label={t('order')} />
      <Tab href="/fnb/kitchen" active={path.startsWith('/fnb/kitchen')} testId="fnb-tab-kitchen" icon={<RestaurantIcon fontSize="small" />} label={t('kitchen')} />
      <Tab href="/fnb/floor" active={path.startsWith('/fnb/floor')} testId="fnb-tab-floor" icon={<TableRestaurantIcon fontSize="small" />} label={t('floor')} />
      <Tab href="/fnb/tables" active={path.startsWith('/fnb/tables')} testId="fnb-tab-tables" icon={<QrCode2Icon fontSize="small" />} label={t('tablesQr')} />
      {hasRole(...MUTATING_ROLES) && <Tab href="/fnb/settings" active={path.startsWith('/fnb/settings')} testId="fnb-tab-settings" icon={<SettingsIcon fontSize="small" />} label={t('cfg.title')} />}
    </Box>
  );
}
