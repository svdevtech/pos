'use client';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { searchProducts, type Product } from '@/lib/api/hooks/products';
import { formatMoney, formatQty } from '@/lib/format';

export interface ProductAutocompleteProps {
  value: Product | null;
  onChange: (product: Product | null) => void;
  label?: string;
  placeholder?: string;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  size?: 'small' | 'medium';
  /** Clear the input after a pick (useful for "add line" flows). */
  clearOnSelect?: boolean;
  /** Ids to hide from the results (already added lines). */
  excludeIds?: readonly string[];
}

/** Async product search (`GET /products?q=&page_size=20`) with a 250 ms debounce. */
export default function ProductAutocomplete({
  value,
  onChange,
  label,
  placeholder,
  error,
  helperText,
  disabled,
  autoFocus,
  size = 'medium',
  clearOnSelect = false,
  excludeIds,
}: ProductAutocompleteProps) {
  const t = useTranslations('products');
  const locale = resolveLocale(useLocale());
  const [input, setInput] = useState('');
  // the results and the query they answer, so a stale list is never offered for a newer query
  const [result, setResult] = useState<{ query: string; items: Product[] }>({ query: '', items: [] });
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const query = input.trim();
    setLoading(true);
    const timer = setTimeout(() => {
      searchProducts(query, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setResult({ query, items });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ query, items: [] });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input]);

  const visible = useMemo(() => {
    // while the typed text has moved on, show nothing rather than the previous product: a quick
    // tap must never pick a row that does not match what is in the box
    if (result.query !== input.trim()) return [];
    return excludeIds?.length ? result.items.filter((o) => !excludeIds.includes(o.id)) : result.items;
  }, [result, input, excludeIds]);

  const displayName = (p: Product) => (locale === 'en' && p.name_en ? p.name_en : p.name);

  return (
    <Autocomplete<Product, false, false, false>
      value={value}
      onChange={(_, next) => {
        onChange(next);
        if (clearOnSelect) setInput('');
      }}
      inputValue={input}
      onInputChange={(_, next, reason) => {
        if (reason === 'reset' && clearOnSelect) return;
        setInput(next);
      }}
      options={visible}
      loading={loading}
      disabled={disabled}
      size={size}
      filterOptions={(x) => x}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(p) => `${p.sku} · ${displayName(p)}`}
      noOptionsText={t('noProducts')}
      loadingText={t('searching')}
      blurOnSelect={clearOnSelect}
      clearOnBlur={clearOnSelect}
      renderOption={(props, p) => (
        <Box component="li" {...props} key={p.id}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap>
              {displayName(p)}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {p.sku}
              {p.primary_barcode ? ` · ${p.primary_barcode}` : ''} · {t('stock')} {formatQty(p.stock_on_hand, locale)}
              {p.unit_name ? ` ${p.unit_name}` : ''}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ ml: 2, whiteSpace: 'nowrap' }}>
            {formatMoney(p.sell_price, locale)}
          </Typography>
        </Box>
      )}
      renderInput={(params) => (
        <GlassInput
          {...params}
          label={label ?? t('search')}
          placeholder={placeholder}
          error={error}
          helperText={helperText}
          autoFocus={autoFocus}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
