'use client';

import Button, { type ButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';
import { forwardRef, type ElementType } from 'react';

const StyledButton = styled(Button)(({ theme }) => ({
  borderRadius: 12,
  minHeight: 40,
  '&.MuiButton-contained': {
    backgroundImage: theme.glass.gradient,
    color: '#fff',
    '&.Mui-disabled': { backgroundImage: 'none' },
  },
  '&.MuiButton-outlined, &.MuiButton-text': {
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(8px)',
    borderColor: theme.glass.border,
    '&:hover': { background: theme.glass.surfaceStrong },
  },
}));

export interface GlassButtonProps extends ButtonProps {
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Render as another element, e.g. `next/link` for navigation buttons. */
  component?: ElementType;
  href?: string;
  target?: string;
}

const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { loading = false, disabled, children, startIcon, variant = 'contained', ...rest },
  ref,
) {
  return (
    <StyledButton
      ref={ref}
      variant={variant}
      disabled={disabled || loading}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : startIcon}
      {...rest}
    >
      {children}
    </StyledButton>
  );
});

export default GlassButton;
