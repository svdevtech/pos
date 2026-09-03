'use client';

import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { formatMoney, formatQty } from '@/lib/format';
import { posApi } from '@/lib/pos/api';
import type { ProductView } from '@/lib/pos/types';

interface Props {
  open: boolean;
  initialQuery?: string;
  qty?: number;
  onClose: () => void;
  onPick: (product: ProductView, qty: number) => void;
}

export default function ProductSearchDialog({ open, initialQuery = '', qty = 1, onClose, onPick }: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const [q, setQ] = useState(initialQuery);
  const [dq, setDq] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setDq(initialQuery);
      setCursor(0);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    const id = window.setTimeout(() => setDq(q.trim()), 250);
    return () => window.clearTimeout(id);
  }, [q]);

  const search = useQuery({
    queryKey: ['products', 'pos-search', dq],
    queryFn: () => posApi.searchProducts(dq, 40),
    enabled: open && dq.length >= 1,
    staleTime: 15_000,
  });

  const results = search.data ?? [];
  const pick = (p: ProductView) => {
    onPick(p, qty);
    onClose();
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      title={t('searchProducts')}
      maxWidth="sm"
      actions={
        <GlassButton variant="text" onClick={onClose}>
          {t('close')}
        </GlassButton>
      }
    >
      <Box sx={{ pt: 1 }}>
        <GlassInput
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('productSearchPlaceholder')}
          inputProps={{ 'data-testid': 'product-search' }}
          InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter' && results[cursor]) {
              e.preventDefault();
              pick(results[cursor]);
            }
          }}
        />
        {qty > 1 && (
          <Typography variant="caption" color="text.secondary">
            {t('scanQtyHint', { qty })}
          </Typography>
        )}
        <Box sx={{ minHeight: 240, maxHeight: '55vh', overflow: 'auto', mt: 1 }}>
          {search.isFetching && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!search.isFetching && dq && results.length === 0 && (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              {t('noProducts')}
            </Typography>
          )}
          {!search.isFetching && results.length > 0 && (
            <List dense disablePadding>
              {results.map((p, i) => (
                <ListItemButton key={p.id} selected={i === cursor} onClick={() => pick(p)} sx={{ borderRadius: 2 }} data-testid="product-result">
                  <ListItemText
                    primary={
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <span>{locale === 'en' && p.name_en ? p.name_en : p.name}</span>
                        <b style={{ whiteSpace: 'nowrap' }}>{formatMoney(p.sell_price, locale)}</b>
                      </Stack>
                    }
                    secondary={
                      <Stack direction="row" spacing={1} alignItems="center" component="span">
                        <span>
                          {p.sku}
                          {p.primary_barcode ? ` · ${p.primary_barcode}` : ''}
                        </span>
                        <Chip
                          component="span"
                          size="small"
                          variant="outlined"
                          color={p.stock_level === 'critical' ? 'error' : p.stock_level === 'warning' ? 'warning' : 'default'}
                          label={`${t('stock')} ${formatQty(p.stock_on_hand, locale)}${p.unit_name ? ` ${p.unit_name}` : ''}`}
                          sx={{ height: 18 }}
                        />
                        {p.is_serial && <Chip component="span" size="small" label="S/N" sx={{ height: 18 }} />}
                      </Stack>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </Box>
    </GlassDialog>
  );
}
