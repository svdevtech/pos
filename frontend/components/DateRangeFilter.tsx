'use client';

import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import dayjs from 'dayjs';
import { useTranslations } from 'next-intl';
import { GlassInput } from '@/components/glass';

export interface DateRange {
  /** YYYY-MM-DD or empty. */
  from: string;
  to: string;
}

export interface DateRangeFilterProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  /** Show quick-pick chips (today / this month / this year). */
  presets?: boolean;
  size?: 'small' | 'medium';
}

export function todayRange(): DateRange {
  const d = dayjs().format('YYYY-MM-DD');
  return { from: d, to: d };
}

export function monthRange(): DateRange {
  return { from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().endOf('month').format('YYYY-MM-DD') };
}

export function yearRange(): DateRange {
  return { from: dayjs().startOf('year').format('YYYY-MM-DD'), to: dayjs().endOf('year').format('YYYY-MM-DD') };
}

export default function DateRangeFilter({ value, onChange, presets = true, size = 'small' }: DateRangeFilterProps) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const isSame = (r: DateRange) => r.from === value.from && r.to === value.to;

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <GlassInput
        type="date"
        size={size}
        label={t('from')}
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        InputLabelProps={{ shrink: true }}
        sx={{ width: 170 }}
        fullWidth={false}
      />
      <GlassInput
        type="date"
        size={size}
        label={t('to')}
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        InputLabelProps={{ shrink: true }}
        sx={{ width: 170 }}
        fullWidth={false}
      />
      {presets && (
        <>
          <Chip size="small" label={t('today')} variant={isSame(todayRange()) ? 'filled' : 'outlined'} onClick={() => onChange(todayRange())} />
          <Chip size="small" label={t('thisMonth')} variant={isSame(monthRange()) ? 'filled' : 'outlined'} onClick={() => onChange(monthRange())} />
          <Chip size="small" label={t('thisYear')} variant={isSame(yearRange()) ? 'filled' : 'outlined'} onClick={() => onChange(yearRange())} />
          {(value.from || value.to) && <Chip size="small" label={tc('all')} variant="outlined" onClick={() => onChange({ from: '', to: '' })} />}
        </>
      )}
    </Stack>
  );
}
