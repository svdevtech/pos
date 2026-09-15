'use client';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import FloorSettings from '@/components/fnb/settings/FloorSettings';
import MenuSettings from '@/components/fnb/settings/MenuSettings';
import ModifierSettings from '@/components/fnb/settings/ModifierSettings';
import PromoSettings from '@/components/fnb/settings/PromoSettings';
import ShopSettings from '@/components/fnb/settings/ShopSettings';
import StationSettings from '@/components/fnb/settings/StationSettings';
import { useSession } from '@/components/Providers';
import { MUTATING_ROLES } from '@/lib/auth/session';

const TABS = ['menu', 'modifiers', 'promos', 'stations', 'floor', 'shop'] as const;

/** Everything a manager sets up for the F&B side: the menu and its recipes, options, stations, the room, and the money/stock rules. */
export default function FnbSettingsPage() {
  const t = useTranslations('fnb.cfg');
  const { hasRole } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number]>('menu');

  if (!hasRole(...MUTATING_ROLES)) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">{t('noAccess')}</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }} data-testid="cfg-tabs">
        {TABS.map((k) => (
          <Tab key={k} value={k} label={t(`tab_${k}`)} data-testid={`cfg-tab-${k}`} />
        ))}
      </Tabs>
      {tab === 'menu' && <MenuSettings />}
      {tab === 'modifiers' && <ModifierSettings />}
      {tab === 'promos' && <PromoSettings />}
      {tab === 'stations' && <StationSettings />}
      {tab === 'floor' && <FloorSettings />}
      {tab === 'shop' && <ShopSettings />}
    </Box>
  );
}
