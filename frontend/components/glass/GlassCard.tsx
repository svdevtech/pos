'use client';

import Box from '@mui/material/Box';
import Paper, { type PaperProps } from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import type { ReactNode } from 'react';

const Root = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'hoverable' && prop !== 'strong',
})<{ hoverable?: boolean; strong?: boolean }>(({ theme, hoverable, strong }) => ({
  padding: theme.spacing(3),
  background: strong ? theme.glass.surfaceStrong : theme.glass.surface,
  transition: theme.transitions.create(['transform', 'box-shadow', 'background'], { duration: 200 }),
  ...(hoverable && {
    cursor: 'pointer',
    '&:hover': {
      transform: 'translateY(-2px)',
      background: theme.glass.surfaceStrong,
    },
  }),
}));

export interface GlassCardProps extends Omit<PaperProps, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned content next to the title (buttons, chips). */
  action?: ReactNode;
  hoverable?: boolean;
  /** Slightly more opaque surface. */
  strong?: boolean;
}

export default function GlassCard({ title, subtitle, action, children, hoverable, strong, ...rest }: GlassCardProps) {
  return (
    <Root hoverable={hoverable} strong={strong} {...rest}>
      {(title || action) && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            {title && (
              <Typography variant="h6" component="h2" noWrap>
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
        </Box>
      )}
      {children}
    </Root>
  );
}
