'use client';

import TextField, { type TextFieldProps } from '@mui/material/TextField';
import { styled } from '@mui/material/styles';
import { forwardRef } from 'react';

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 12,
    background: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)',
    backdropFilter: 'blur(8px)',
    '& fieldset': { borderColor: theme.glass.border },
    '&:hover fieldset': {
      borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(30,136,229,0.5)',
    },
    '&.Mui-focused fieldset': { borderColor: theme.palette.primary.main, borderWidth: 2 },
  },
  '& .MuiInputLabel-root': { color: theme.palette.text.secondary },
}));

export type GlassInputProps = TextFieldProps;

const GlassInput = forwardRef<HTMLDivElement, GlassInputProps>(function GlassInput(
  { fullWidth = true, variant = 'outlined', ...rest },
  ref,
) {
  return <StyledTextField ref={ref} fullWidth={fullWidth} variant={variant} {...rest} />;
});

export default GlassInput;
