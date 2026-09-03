'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions (buttons). */
  actions?: ReactNode;
  /** When set, renders a back arrow linking to this href. */
  backHref?: string;
  loading?: boolean;
}

export default function PageHeader({ title, subtitle, actions, backHref, loading }: PageHeaderProps) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        {backHref && (
          <IconButton component={Link} href={backHref} aria-label="back" edge="start">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" fontWeight={700} noWrap>
            {loading ? <Skeleton width={220} /> : title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {loading ? <Skeleton width={160} /> : subtitle}
            </Typography>
          )}
        </Stack>
      </Stack>
      {actions && (
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
