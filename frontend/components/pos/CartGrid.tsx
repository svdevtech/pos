'use client';

import AddIcon from '@mui/icons-material/Add';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RemoveIcon from '@mui/icons-material/Remove';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { formatMoney, formatQty } from '@/lib/format';
import { lineTotal, type CartLine } from '@/lib/pos/cart';
import type { QuoteLine } from '@/lib/pos/types';
import { dec } from '@/lib/pos/types';

interface Props {
  lines: CartLine[];
  /** Server-priced lines (same order as `lines`) when a quote is available. */
  quoteLines?: QuoteLine[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onChange: (key: string, patch: Partial<CartLine>) => void;
  onRemove: (key: string) => void;
  /** Whether keyboard shortcuts (Delete / Esc) are active. */
  hotkeys?: boolean;
  allowPriceEdit?: boolean;
  maxHeight?: number | string;
}

function NumberCell({
  value,
  onCommit,
  min = 0,
  step = 1,
  width = 64,
  ariaLabel,
  disabled,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  step?: number;
  width?: number;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || n < min) {
      setText(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <InputBase
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
      onFocus={(e) => e.target.select()}
      inputProps={{ inputMode: 'decimal', step, min, 'aria-label': ariaLabel, style: { textAlign: 'right', padding: '4px 6px' } }}
      sx={{
        width,
        fontSize: 15,
        fontVariantNumeric: 'tabular-nums',
        borderRadius: 1.5,
        border: (th) => `1px solid ${th.glass.border}`,
        background: 'rgba(255,255,255,0.06)',
        '&.Mui-focused': { borderColor: 'primary.main' },
      }}
    />
  );
}

export default function CartGrid({
  lines,
  quoteLines,
  selectedKey,
  onSelect,
  onChange,
  onRemove,
  hotkeys = true,
  allowPriceEdit = false,
  maxHeight = '100%',
}: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const [serialFor, setSerialFor] = useState<CartLine | null>(null);
  const [serialText, setSerialText] = useState('');
  const lastKeyRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // Delete removes the selected line, Escape clears selection.
  useEffect(() => {
    if (!hotkeys) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        onSelect(null);
        return;
      }
      if (typing) return;
      if (e.key === 'Delete' && selectedKey) {
        e.preventDefault();
        onRemove(selectedKey);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hotkeys, selectedKey, onRemove, onSelect]);

  // Scroll a newly added line into view.
  useEffect(() => {
    const last = lines[lines.length - 1];
    if (last && last.key !== lastKeyRef.current) {
      lastKeyRef.current = last.key;
      const row = bodyRef.current?.querySelector<HTMLElement>(`[data-key="${last.key}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    }
  }, [lines]);

  const openSerial = (l: CartLine) => {
    setSerialFor(l);
    setSerialText(l.serial_no ?? '');
  };

  const quoteFor = (i: number, l: CartLine): QuoteLine | undefined => {
    const q = quoteLines?.[i];
    return q && q.product_id === l.product_id ? q : undefined;
  };

  const displayName = (l: CartLine) => (locale === 'en' && l.name_en ? l.name_en : l.name);

  return (
    <>
      <TableContainer
        sx={{
          maxHeight,
          height: '100%',
          overflow: 'auto',
          borderRadius: (th) => `${th.glass.radius}px`,
          border: (th) => `1px solid ${th.glass.border}`,
          background: (th) => th.glass.surface,
        }}
      >
        <Table stickyHeader size="small" aria-label={t('cart')} data-testid="cart-grid">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 36 }}>#</TableCell>
              <TableCell>{t('item')}</TableCell>
              <TableCell align="right" sx={{ width: 96 }}>
                {t('price')}
              </TableCell>
              <TableCell align="center" sx={{ width: 150 }}>
                {t('qty')}
              </TableCell>
              <TableCell align="right" sx={{ width: 96 }}>
                {t('discount')}
              </TableCell>
              <TableCell align="right" sx={{ width: 110 }}>
                {t('lineTotal')}
              </TableCell>
              <TableCell align="center" sx={{ width: 88 }} />
            </TableRow>
          </TableHead>
          <TableBody ref={bodyRef}>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 8, border: 0 }}>
                  <Typography color="text.secondary">{t('emptyCart')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('emptyCartHint')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {lines.map((l, i) => {
              const q = quoteFor(i, l);
              const price = q ? dec(q.unit_price) : (l.price_override ?? l.unit_price);
              const promo = q ? dec(q.promo_discount) : 0;
              const total = q ? dec(q.line_total) : lineTotal(l);
              const selected = l.key === selectedKey;
              const serialMissing = l.is_serial && !l.is_free && !l.serial_no?.trim();
              return (
                <TableRow
                  key={l.key}
                  data-key={l.key}
                  data-testid="cart-line"
                  hover
                  selected={selected}
                  onClick={() => onSelect(selected ? null : l.key)}
                  sx={{ cursor: 'pointer', '& td': { py: 0.75 } }}
                >
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.25 }}>
                      {displayName(l)}
                    </Typography>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="caption" color="text.secondary">
                        {l.sku}
                        {l.unit_name ? ` · ${l.unit_name}` : ''}
                      </Typography>
                      {l.is_free && <Chip size="small" color="success" label={t('free')} sx={{ height: 18 }} />}
                      {promo > 0 && (
                        <Chip size="small" color="secondary" label={`${t('promo')} -${formatMoney(promo, locale)}`} sx={{ height: 18 }} />
                      )}
                      {l.is_serial && (
                        <Chip
                          size="small"
                          color={serialMissing ? 'warning' : 'default'}
                          variant="outlined"
                          label={l.serial_no?.trim() ? `S/N ${l.serial_no}` : t('serialRequired')}
                          onClick={(e) => {
                            e.stopPropagation();
                            openSerial(l);
                          }}
                          sx={{ height: 18 }}
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {allowPriceEdit ? (
                      <NumberCell
                        value={l.price_override ?? price}
                        ariaLabel={t('price')}
                        width={84}
                        step={0.25}
                        onCommit={(n) => onChange(l.key, { price_override: n === l.unit_price ? undefined : n })}
                      />
                    ) : (
                      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(price, locale).replace('฿ ', '')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center">
                      <IconButton
                        size="small"
                        aria-label={t('decreaseQty')}
                        onClick={() => (l.qty > 1 ? onChange(l.key, { qty: l.qty - 1 }) : onRemove(l.key))}
                      >
                        <RemoveIcon fontSize="small" />
                      </IconButton>
                      <NumberCell value={l.qty} min={0.001} step={1} ariaLabel={t('qty')} onCommit={(n) => (n > 0 ? onChange(l.key, { qty: n }) : onRemove(l.key))} />
                      <IconButton size="small" aria-label={t('increaseQty')} onClick={() => onChange(l.key, { qty: l.qty + 1 })}>
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <NumberCell
                      value={l.discount}
                      ariaLabel={t('lineDiscount')}
                      width={80}
                      step={1}
                      disabled={l.is_free}
                      onCommit={(n) => onChange(l.key, { discount: n })}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="line-total">
                      {formatQty(total, locale, 2)}
                    </Typography>
                  </TableCell>
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={t('freeItem')}>
                      <IconButton
                        size="small"
                        color={l.is_free ? 'success' : 'default'}
                        aria-label={t('freeItem')}
                        aria-pressed={l.is_free}
                        onClick={() => onChange(l.key, { is_free: !l.is_free, discount: l.is_free ? l.discount : 0 })}
                      >
                        <CardGiftcardIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('remove')}>
                      <IconButton size="small" color="error" aria-label={t('remove')} onClick={() => onRemove(l.key)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <GlassDialog
        open={Boolean(serialFor)}
        onClose={() => setSerialFor(null)}
        title={t('serialTitle')}
        maxWidth="xs"
        actions={
          <>
            <GlassButton variant="text" onClick={() => setSerialFor(null)}>
              {t('cancelAction')}
            </GlassButton>
            <GlassButton
              onClick={() => {
                if (serialFor) onChange(serialFor.key, { serial_no: serialText.trim() });
                setSerialFor(null);
              }}
            >
              {t('save')}
            </GlassButton>
          </>
        }
      >
        <Box sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {serialFor ? displayName(serialFor) : ''}
          </Typography>
          <GlassInput
            autoFocus
            label={t('serialNo')}
            value={serialText}
            onChange={(e) => setSerialText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && serialFor) {
                onChange(serialFor.key, { serial_no: serialText.trim() });
                setSerialFor(null);
              }
            }}
          />
        </Box>
      </GlassDialog>
    </>
  );
}
