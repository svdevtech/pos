'use client';

import HistoryIcon from '@mui/icons-material/History';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import SaveIcon from '@mui/icons-material/Save';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useSession } from '@/components/Providers';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import CameraScanDialog, { type CameraScanResult } from '@/components/pos/CameraScanDialog';
import { cameraSupported } from '@/lib/pos/barcodeCamera';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import { useCreateStockTake, useSaveCounts, useStockTakes } from '@/lib/api/hooks/inventory';
import { useProduct } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatMoney, formatQty } from '@/lib/format';
import { posApi } from '@/lib/pos/api';
import { dec } from '@/lib/pos/types';

interface Scanned {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  unit?: string;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  warning: 'warning',
  critical: 'error',
};

function StockCheckContent() {
  const t = useTranslations('stockCheck');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canCount = hasRole(...MUTATING_ROLES);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [current, setCurrent] = useState<Scanned | null>(null);
  const [recent, setRecent] = useState<Scanned[]>([]);
  const [notFound, setNotFound] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // counting mode writes into an open stock take
  const [countMode, setCountMode] = useState(false);
  const [takeId, setTakeId] = useState('');
  const [counted, setCounted] = useState('');
  const takes = useStockTakes({ page: 1, page_size: 20 });
  const openTakes = (takes.data?.items ?? []).filter((s) => s.status === 'open');
  const createTake = useCreateStockTake();
  const saveCounts = useSaveCounts(takeId);

  useEffect(() => setCamera(cameraSupported()), []);
  useEffect(() => {
    if (!takeId && openTakes.length > 0) setTakeId(openTakes[0].id);
  }, [openTakes, takeId]);

  /** Looks the code up and shows it; shared by the text field and the camera. */
  const lookup = useCallback(
    async (raw: string): Promise<CameraScanResult> => {
      const barcode = raw.trim();
      if (!barcode) return { ok: false, label: '' };
      setBusy(true);
      try {
        const p = await posApi.byBarcode(barcode);
        const item: Scanned = {
          id: p.id,
          name: locale === 'en' && p.name_en ? p.name_en : p.name,
          sku: p.sku,
          barcode: p.scanned_barcode || barcode,
          stock: dec(p.stock_on_hand),
          unit: p.unit_name,
        };
        setCurrent(item);
        setCounted('');
        setNotFound(null);
        setRecent((r) => [item, ...r.filter((x) => x.id !== item.id)].slice(0, 20));
        return { ok: true, label: `${item.name} · ${t('onHandShort', { qty: formatQty(item.stock, locale) })}` };
      } catch {
        setNotFound(barcode);
        return { ok: false, label: t('notFound', { code: barcode }) };
      } finally {
        setBusy(false);
        setCode('');
      }
    },
    [locale, t],
  );

  // full product record for cost / reorder level (the scan endpoint only carries selling data)
  const detail = useProduct(current?.id);

  const submit = () => {
    void lookup(code).catch((e) => toast.error(errorMessage(e)));
  };

  const saveCount = () => {
    if (!current || !takeId) return;
    saveCounts.mutate([{ product_id: current.id, counted_qty: decStr(counted, 3), note: '' }], {
      onSuccess: () => {
        toast.success(t('countSaved', { name: current.name }));
        setCounted('');
        inputRef.current?.focus();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const startTake = () => {
    createTake.mutate(
      { note: t('takeFromPhone'), empty: true },
      {
        onSuccess: (s) => {
          setTakeId(s.id);
          toast.success(t('takeCreated', { doc: s.doc_no }));
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const stockValue = detail.data ? num(detail.data.cost_avg) * (current?.stock ?? 0) : null;
  const minLevel = detail.data ? num(detail.data.min_level1) : null;
  const variance = current && counted !== '' ? Number(counted) - current.stock : null;

  return (
    <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto', width: '100%' }}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} backHref="/inventory" />

      <GlassCard>
        <Stack spacing={1.5}>
          <GlassInput
            inputRef={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t('scanPlaceholder')}
            autoFocus
            autoComplete="off"
            inputProps={{ 'data-testid': 'check-scan', 'aria-label': t('scanPlaceholder'), inputMode: 'text' }}
            InputProps={{
              sx: { fontSize: 18 },
              endAdornment: camera ? (
                <InputAdornment position="end">
                  <IconButton aria-label={t('scanWithCamera')} onClick={() => setCameraOpen(true)} data-testid="check-camera">
                    <PhotoCameraIcon />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            }}
          />
          {camera && (
            <GlassButton size="large" startIcon={<PhotoCameraIcon />} onClick={() => setCameraOpen(true)} disabled={busy}>
              {t('scanWithCamera')}
            </GlassButton>
          )}
        </Stack>
      </GlassCard>

      {notFound && !current && <Alert severity="warning">{t('notFound', { code: notFound })}</Alert>}

      {current && (
        <GlassCard data-testid="check-result">
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
              <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                {current.name}
              </Typography>
              {detail.data?.stock_level && (
                <Chip
                  size="small"
                  color={LEVEL_COLOR[String(detail.data.stock_level)] ?? 'default'}
                  label={t(`level.${detail.data.stock_level}` as 'level.ok')}
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {current.sku} · {current.barcode}
              {detail.data?.category_name ? ` · ${detail.data.category_name}` : ''}
            </Typography>

            <Box sx={{ py: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {t('onHand')}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="baseline">
                <Typography variant="h2" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="check-stock">
                  {formatQty(current.stock, locale)}
                </Typography>
                <Typography variant="h6" color="text.secondary">
                  {current.unit ?? ''}
                </Typography>
              </Stack>
            </Box>

            <Divider />
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
              <Fact label={t('sellPrice')} value={detail.data ? formatMoney(num(detail.data.sell_price), locale) : '—'} />
              <Fact label={t('costAvg')} value={detail.data ? formatMoney(num(detail.data.cost_avg), locale) : '—'} />
              <Fact label={t('stockValue')} value={stockValue == null ? '—' : formatMoney(stockValue, locale)} />
              <Fact label={t('minLevel')} value={minLevel == null ? '—' : formatQty(minLevel, locale)} />
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <GlassButton
                variant="outlined"
                size="small"
                startIcon={<HistoryIcon />}
                component={Link}
                href={`/inventory/movements?product_id=${current.id}`}
              >
                {t('movements')}
              </GlassButton>
              {canCount && (
                <GlassButton variant="text" size="small" component={Link} href={`/products/${current.id}`}>
                  {t('openProduct')}
                </GlassButton>
              )}
            </Stack>

            {countMode && (
              <>
                <Divider />
                <Stack spacing={1}>
                  <GlassInput
                    label={t('countedQty')}
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    inputProps={{ inputMode: 'decimal', 'data-testid': 'check-counted', style: { fontSize: 20 } }}
                    helperText={
                      variance == null || variance === 0
                        ? t('countedHint')
                        : t('variance', { qty: formatQty(Math.abs(variance), locale), dir: variance > 0 ? t('over') : t('short') })
                    }
                  />
                  <GlassButton
                    startIcon={<SaveIcon />}
                    onClick={saveCount}
                    disabled={!takeId || counted === ''}
                    loading={saveCounts.isPending}
                    data-testid="check-save-count"
                  >
                    {t('saveCount')}
                  </GlassButton>
                </Stack>
              </>
            )}
          </Stack>
        </GlassCard>
      )}

      {canCount && (
        <GlassCard>
          <Stack spacing={1.5}>
            <FormControlLabel
              control={<Switch checked={countMode} onChange={(e) => setCountMode(e.target.checked)} data-testid="check-count-mode" />}
              label={t('countMode')}
            />
            {countMode && (
              <>
                <Typography variant="caption" color="text.secondary">
                  {t('countModeHint')}
                </Typography>
                {openTakes.length > 0 ? (
                  <GlassInput select label={t('stockTake')} value={takeId} onChange={(e) => setTakeId(e.target.value)}>
                    {openTakes.map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.doc_no}
                      </MenuItem>
                    ))}
                  </GlassInput>
                ) : (
                  <Alert severity="info">{t('noOpenTake')}</Alert>
                )}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <GlassButton variant="outlined" size="small" onClick={startTake} loading={createTake.isPending}>
                    {t('newTake')}
                  </GlassButton>
                  {takeId && (
                    <GlassButton variant="text" size="small" component={Link} href={`/inventory/stock-takes/${takeId}`}>
                      {t('openTake')}
                    </GlassButton>
                  )}
                </Stack>
              </>
            )}
          </Stack>
        </GlassCard>
      )}

      {recent.length > 1 && (
        <GlassCard title={t('recent')}>
          <Stack divider={<Divider flexItem />} data-testid="check-recent">
            {recent.map((r) => (
              <Stack
                key={r.id}
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ py: 1, cursor: 'pointer' }}
                onClick={() => setCurrent(r)}
              >
                <Typography variant="body2" sx={{ minWidth: 0, pr: 1 }} noWrap>
                  {r.name}
                </Typography>
                <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatQty(r.stock, locale)} {r.unit ?? ''}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </GlassCard>
      )}

      <CameraScanDialog
        open={cameraOpen}
        onClose={() => {
          setCameraOpen(false);
          inputRef.current?.focus();
        }}
        onDetect={lookup}
      />
    </Stack>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Stack sx={{ minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function StockCheckPage() {
  return (
    <RequireAuth>
      <StockCheckContent />
    </RequireAuth>
  );
}
