'use client';

import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import DateRangeFilter, { type DateRange } from '@/components/DateRangeFilter';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import { GlassInput } from '@/components/glass';
import MovementsGrid from '@/components/inventory/MovementsGrid';
import { MOVE_TYPES, type MovementParams } from '@/lib/api/hooks/inventory';
import type { Product } from '@/lib/api/hooks/products';
import { nextDay } from '@/lib/dates';

/** Movement ledger with product / type / date filters. */
export default function MovementsLedger() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState('');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });

  const filter = useMemo<Omit<MovementParams, 'page' | 'page_size'>>(
    () => ({ product_id: product?.id, type, from: range.from || undefined, to: nextDay(range.to) || undefined }),
    [product, type, range],
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <Stack sx={{ minWidth: 280, flex: 1 }}>
          <ProductAutocomplete value={product} onChange={setProduct} size="small" label={t('filterProduct')} />
        </Stack>
        <GlassInput
          select
          size="small"
          label={t('type')}
          value={type}
          onChange={(e) => setType(e.target.value)}
          sx={{ minWidth: 170 }}
          fullWidth={false}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{tc('all')}</MenuItem>
          {MOVE_TYPES.map((m) => (
            <MenuItem key={m} value={m}>
              {t(`moveTypes.${m}`)}
            </MenuItem>
          ))}
        </GlassInput>
        <DateRangeFilter value={range} onChange={setRange} />
      </Stack>
      <MovementsGrid filter={filter} />
    </Stack>
  );
}
