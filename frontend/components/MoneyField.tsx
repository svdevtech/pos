'use client';

import InputAdornment from '@mui/material/InputAdornment';
import { forwardRef } from 'react';
import { GlassInput, type GlassInputProps } from '@/components/glass';
import { CURRENCY_SYMBOL } from '@/lib/format';

export interface MoneyFieldProps extends Omit<GlassInputProps, 'type' | 'value' | 'onChange'> {
  /** Kept as a string so partially typed values ("12.") survive re-renders. */
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  /** Show the currency prefix (default true). Set false for quantities. */
  currency?: boolean;
  /** Allow a leading minus sign (default false). */
  allowNegative?: boolean;
  /** Max decimals accepted while typing (default 2; use 3 for quantities). */
  decimals?: number;
  /** Text shown after the input, e.g. a unit name. */
  suffix?: string;
}

/**
 * Numeric text field for money / quantities. Filters keystrokes to a decimal
 * pattern, right-aligns, and reports the raw string (parse with Number()).
 */
const MoneyField = forwardRef<HTMLDivElement, MoneyFieldProps>(function MoneyField(
  { value, onChange, currency = true, allowNegative = false, decimals = 2, suffix, InputProps, inputProps, ...rest },
  ref,
) {
  const pattern = new RegExp(`^${allowNegative ? '-?' : ''}\\d*(?:\\.\\d{0,${decimals}})?$`);
  return (
    <GlassInput
      ref={ref}
      value={value ?? ''}
      onChange={(e) => {
        const next = e.target.value.replace(/,/g, '');
        if (next === '' || pattern.test(next)) onChange(next);
      }}
      onBlur={(e) => {
        const raw = e.target.value;
        if (raw !== '' && raw !== '-' && !Number.isNaN(Number(raw))) onChange(String(Number(raw)));
        else if (raw === '-') onChange('');
        rest.onBlur?.(e);
      }}
      inputProps={{ inputMode: 'decimal', style: { textAlign: 'right' }, ...inputProps }}
      InputProps={{
        ...(currency && { startAdornment: <InputAdornment position="start">{CURRENCY_SYMBOL}</InputAdornment> }),
        ...(suffix && { endAdornment: <InputAdornment position="end">{suffix}</InputAdornment> }),
        ...InputProps,
      }}
      {...rest}
    />
  );
});

export default MoneyField;
