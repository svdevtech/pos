'use client';

import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useTranslations } from 'next-intl';

/** True on touch devices (tablets/phones), where the OS keyboard would cover the dialog. */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Applies a keypad press to an amount string. Exported for tests. */
export function applyKey(value: string, key: string): string {
  if (key === 'back') return value.slice(0, -1);
  if (key === 'clear') return '';
  if (key === '.') return value.includes('.') ? value : `${value === '' ? '0' : value}.`;
  const next = `${value}${key}`;
  // keep it a sane money string: max 2 decimals, no leading zeros like "007"
  if (/^\d*\.?\d{0,2}$/.test(next)) return next.replace(/^0+(?=\d)/, '');
  return value;
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', '.'] as const;

export interface NumericKeypadProps {
  onKey: (key: string) => void;
  /** Renders the ⌫ and C keys; the parent decides what they clear. */
  disabled?: boolean;
}

/**
 * Compact POS keypad. Used instead of the on-screen OS keyboard on tablets, where the
 * keyboard leaves too little room for the payment dialog.
 */
export default function NumericKeypad({ onKey, disabled = false }: NumericKeypadProps) {
  const t = useTranslations('pos');
  const key = (label: React.ReactNode, value: string, extra?: object) => (
    <Button
      key={value}
      variant="outlined"
      disabled={disabled}
      onClick={() => onKey(value)}
      onMouseDown={(e) => e.preventDefault()} // keep focus on the amount field
      sx={{
        minWidth: 0,
        py: 1.2,
        fontSize: 20,
        fontWeight: 700,
        borderRadius: 2,
        color: 'text.primary',
        borderColor: 'divider',
        ...extra,
      }}
      data-testid={`keypad-${value}`}
      aria-label={value === 'clear' ? t('clearAmount') : value === 'back' ? t('backspace') : value}
    >
      {label}
    </Button>
  );

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        mt: 1,
      }}
    >
      {KEYS.map((k) => key(k, k))}
      {key(<BackspaceOutlinedIcon fontSize="small" />, 'back', { gridColumn: '4', gridRow: '1' })}
      {key('C', 'clear', { gridColumn: '4', gridRow: '2 / span 2', fontSize: 20, color: 'warning.main', borderColor: 'warning.main' })}
    </Box>
  );
}
