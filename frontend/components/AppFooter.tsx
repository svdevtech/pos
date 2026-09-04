'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';

interface Props {
  /** `bar` sits at the bottom of a fixed-height shell (POS); `inline` flows after page content. */
  variant?: 'inline' | 'bar';
  /**
   * Push the line to the bottom of the surrounding box. Off for short centred pages (login), where
   * a bottom-pinned footer can land below the visible area on a phone or tablet browser.
   */
  pinBottom?: boolean;
}

/**
 * The ownership line, shown on every screen. It is deliberately tiny and muted: on the POS it must
 * not eat into the cashier's working area, and on the other screens it should read as a footer
 * rather than content.
 */
export default function AppFooter({ variant = 'inline', pinBottom = true }: Props) {
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
          : { mt: pinBottom ? 'auto' : 1.5 }),
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.85, fontSize: variant === 'bar' ? 11 : 12 }}>
        {t('copyright', { year })}
      </Typography>
    </Box>
  );
}
