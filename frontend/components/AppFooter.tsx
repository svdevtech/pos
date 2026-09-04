'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';

interface Props {
  /** `bar` sits at the bottom of a fixed-height shell (POS); `inline` flows after page content. */
  variant?: 'inline' | 'bar';
}

/**
 * The ownership line, shown on every screen. It is deliberately tiny and muted: on the POS it must
 * not eat into the cashier's working area, and on the other screens it should read as a footer
 * rather than content.
 */
export default function AppFooter({ variant = 'inline' }: Props) {
  const t = useTranslations('common');
  const year = new Date().getFullYear();

  return (
    <Box
      component="footer"
      sx={{
        textAlign: 'center',
        py: variant === 'bar' ? 0.5 : 2,
        px: 1,
        ...(variant === 'bar'
          ? { borderTop: (th) => `1px solid ${th.glass.border}`, flexShrink: 0 }
          : { mt: 'auto' }),
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.7, fontSize: variant === 'bar' ? 11 : 12 }}>
        {t('copyright', { year })}
      </Typography>
    </Box>
  );
}
