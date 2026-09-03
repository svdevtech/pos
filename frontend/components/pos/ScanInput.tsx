'use client';

import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SearchIcon from '@mui/icons-material/Search';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import { useTranslations } from 'next-intl';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { GlassInput } from '@/components/glass';
import { looksLikeBarcode, parseQtyPrefix } from '@/lib/pos/cart';

export interface ScanInputHandle {
  focus: () => void;
  clear: () => void;
}

interface Props {
  /** Called on Enter with a barcode-looking string (after the qty prefix is stripped). */
  onScan: (code: string, qty: number) => Promise<void> | void;
  /** Called on Enter with free text (or the search icon). */
  onSearch: (query: string, qty: number) => void;
  /** When true (a dialog is open) the field does not steal focus back. */
  suspended?: boolean;
  busy?: boolean;
  autoFocus?: boolean;
}

/**
 * The cashier's scan box. Keeps itself focused so a USB/HID barcode scanner always lands here.
 * `3*` prefix multiplies the quantity of the next scan.
 */
const ScanInput = forwardRef<ScanInputHandle, Props>(function ScanInput(
  { onScan, onSearch, suspended = false, busy = false, autoFocus = true },
  ref,
) {
  const t = useTranslations('pos');
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => setValue(''),
  }));

  useEffect(() => {
    if (!suspended && autoFocus) inputRef.current?.focus();
  }, [suspended, autoFocus]);

  // Re-focus after a blur unless a dialog/other input took focus deliberately.
  const handleBlur = () => {
    if (suspended) return;
    window.setTimeout(() => {
      if (suspended) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const isTypingElsewhere =
        active &&
        active !== inputRef.current &&
        (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable);
      if (isTypingElsewhere) return;
      if (document.querySelector('[role="dialog"], [role="presentation"] .MuiDrawer-paper')) return;
      inputRef.current?.focus();
    }, 50);
  };

  const submit = async () => {
    const raw = value;
    if (!raw.trim()) return;
    const { qty, text } = parseQtyPrefix(raw);
    if (!text) return;
    setValue('');
    if (looksLikeBarcode(text)) {
      await onScan(text, qty);
    } else {
      onSearch(text, qty);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      setValue('');
    }
  };

  const { qty } = parseQtyPrefix(value.endsWith('*') ? `${value}x` : value);
  const qtyHint = value.match(/^\s*(\d+(?:\.\d+)?)\s*[*xX×]/) ? t('scanQtyHint', { qty }) : undefined;

  return (
    <GlassInput
      inputRef={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      placeholder={t('scanOrSearch')}
      helperText={qtyHint}
      autoComplete="off"
      inputProps={{ 'aria-label': t('scanOrSearch'), 'data-testid': 'scan-input', inputMode: 'text' }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            {busy ? <CircularProgress size={18} /> : <QrCodeScannerIcon color="primary" />}
          </InputAdornment>
        ),
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              size="small"
              aria-label={t('searchProducts')}
              onClick={() => {
                const { qty: q, text } = parseQtyPrefix(value);
                setValue('');
                onSearch(text, q);
              }}
            >
              <SearchIcon />
            </IconButton>
          </InputAdornment>
        ),
        sx: { fontSize: 18 },
      }}
    />
  );
});

export default ScanInput;
