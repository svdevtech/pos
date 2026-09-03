'use client';

import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { GlassCard } from '@/components/glass';

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
  color?: string;
}

/** Compact KPI card (label above a large value). */
export default function StatTile({ label, value, hint, loading, color }: StatTileProps) {
  return (
    <GlassCard sx={{ p: 2.5, height: '100%' }}>
      <Typography variant="body2" color="text.secondary" noWrap>
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5, color }} noWrap>
        {loading ? <Skeleton width={120} /> : value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          {loading ? <Skeleton width={80} /> : hint}
        </Typography>
      )}
    </GlassCard>
  );
}
