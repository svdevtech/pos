'use client';

import DeleteIcon from '@mui/icons-material/Delete';
import PrintIcon from '@mui/icons-material/Print';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import Barcode from '@/components/Barcode';
import PageHeader from '@/components/PageHeader';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import QueryError from '@/components/QueryError';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { num } from '@/lib/api/hooks/common';
import { useLabelSheet, useLabelTemplates, type LabelTemplate, type Product } from '@/lib/api/hooks/products';
import { formatMoney } from '@/lib/format';

interface Picked {
  product: Product;
  copies: number;
}

interface Geometry {
  columns: number;
  rows: number;
  labelW: number; // mm
  labelH: number; // mm
  gapX: number;
  gapY: number;
  pageLeft: number;
  pageTop: number;
  pageWidth: number;
  barHeight: number;
  showSku: boolean;
  showName: boolean;
  showPrice: boolean;
  showBarcode: boolean;
}

function dim(map: Record<string, unknown> | null | undefined, key: string, fallback: number): number {
  const v = map?.[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function flag(map: Record<string, unknown> | null | undefined, key: string, fallback = true): boolean {
  const v = map?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Derives a printable grid from the template (mm). A4 with 4×11 labels by default. */
function geometry(t: LabelTemplate | null): Geometry {
  const columns = Math.max(1, t?.columns ?? 4);
  const rows = Math.max(1, t?.rows ?? 11);
  const pageWidth = dim(t?.dims, 'page_width', 210);
  const pageLeft = dim(t?.dims, 'page_left', 5);
  const pageTop = dim(t?.dims, 'page_top', 10);
  const gapX = dim(t?.dims, 'gap_x', 2);
  const gapY = dim(t?.dims, 'gap_y', 2);
  const usable = pageWidth - pageLeft * 2;
  const labelW = dim(t?.dims, 'label_width', (usable - gapX * (columns - 1)) / columns);
  const labelH = dim(t?.dims, 'label_height', (297 - pageTop * 2 - gapY * (rows - 1)) / rows);
  return {
    columns,
    rows,
    labelW,
    labelH,
    gapX,
    gapY,
    pageLeft,
    pageTop,
    pageWidth,
    barHeight: dim(t?.dims, 'bar_height', Math.max(8, labelH * 0.4)),
    showSku: flag(t?.visible, 'sku'),
    showName: flag(t?.visible, 'name'),
    showPrice: flag(t?.visible, 'price'),
    showBarcode: flag(t?.visible, 'barcode'),
  };
}

export default function LabelsPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const [picked, setPicked] = useState<Picked[]>([]);
  const [template, setTemplate] = useState('');
  const [copies, setCopies] = useState('1');
  const [pick, setPick] = useState<Product | null>(null);

  const templates = useLabelTemplates();
  useEffect(() => {
    if (!template && templates.data?.length) setTemplate(templates.data[0].code);
  }, [templates.data, template]);

  // The API expands `copies` uniformly; per-product copies are expanded client side.
  const ids = useMemo(() => picked.map((p) => p.product.id), [picked]);
  const sheet = useLabelSheet(ids, template, 1);

  const labels = useMemo(() => {
    if (!sheet.data) return [];
    const globalCopies = Math.max(1, Math.min(200, Number(copies) || 1));
    const out: { key: string; sku: string; barcode: string; name: string; price: string }[] = [];
    for (const item of picked) {
      const found = sheet.data.labels.filter((l) => l.sku === item.product.sku);
      const source = found.length
        ? found
        : [{ sku: item.product.sku, barcode: item.product.primary_barcode ?? '', name: item.product.name, price: item.product.sell_price }];
      const n = item.copies * globalCopies;
      for (let i = 0; i < n; i++) {
        for (const l of source) out.push({ key: `${l.sku}-${i}-${out.length}`, sku: l.sku, barcode: l.barcode, name: l.name, price: String(num(l.price)) });
      }
    }
    return out;
  }, [sheet.data, picked, copies]);

  const tpl = sheet.data?.template ?? templates.data?.find((x) => x.code === template) ?? null;
  const geo = useMemo(() => geometry(tpl), [tpl]);
  const perPage = geo.columns * geo.rows;
  const pages = useMemo(() => {
    const out: (typeof labels)[] = [];
    for (let i = 0; i < labels.length; i += perPage) out.push(labels.slice(i, i + perPage));
    return out;
  }, [labels, perPage]);

  const addProduct = (p: Product | null) => {
    if (!p) return;
    setPicked((prev) => (prev.some((x) => x.product.id === p.id) ? prev : [...prev, { product: p, copies: 1 }]));
    setPick(null);
  };

  return (
    <Stack spacing={3}>
      <GlobalStyles
        styles={{
          '@media print': {
            'body *': { visibility: 'hidden' },
            '#label-sheet, #label-sheet *': { visibility: 'visible' },
            '#label-sheet': { position: 'absolute', left: 0, top: 0, width: '100%', margin: 0, padding: 0 },
            '.label-page': { pageBreakAfter: 'always', breakAfter: 'page' },
            '@page': { margin: 0 },
          },
        }}
      />
      <PageHeader
        title={t('labels')}
        subtitle={t('labelsHint')}
        backHref="/products"
        actions={
          <GlassButton startIcon={<PrintIcon />} disabled={labels.length === 0 || sheet.isFetching} onClick={() => window.print()}>
            {tc('print')} ({labels.length})
          </GlassButton>
        }
      />

      <Grid container spacing={3} className="no-print">
        <Grid item xs={12} md={5}>
          <GlassCard title={t('pickProducts')}>
            <Stack spacing={2}>
              <ProductAutocomplete value={pick} onChange={addProduct} clearOnSelect excludeIds={ids} label={t('search')} />
              <Stack direction="row" spacing={2}>
                <GlassInput
                  select
                  label={t('labelTemplate')}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  disabled={templates.isPending}
                  helperText={templates.data?.length === 0 ? t('noTemplates') : undefined}
                >
                  {(templates.data ?? []).map((x) => (
                    <MenuItem key={x.id} value={x.code}>
                      {x.name} ({x.columns}×{x.rows})
                    </MenuItem>
                  ))}
                  {templates.data?.length === 0 && <MenuItem value="">{t('defaultTemplate')}</MenuItem>}
                </GlassInput>
                <GlassInput
                  label={t('copies')}
                  value={copies}
                  onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))}
                  inputProps={{ inputMode: 'numeric', style: { textAlign: 'right' } }}
                  sx={{ maxWidth: 120 }}
                />
              </Stack>
              <QueryError error={sheet.error} onRetry={() => sheet.refetch()} />
              {picked.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('noPicked')}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {picked.map((item) => (
                    <ListItem
                      key={item.product.id}
                      disableGutters
                      secondaryAction={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <GlassInput
                            size="small"
                            value={String(item.copies)}
                            onChange={(e) => {
                              const n = Math.max(1, Math.min(200, Number(e.target.value.replace(/\D/g, '')) || 1));
                              setPicked((prev) => prev.map((x) => (x.product.id === item.product.id ? { ...x, copies: n } : x)));
                            }}
                            inputProps={{ inputMode: 'numeric', style: { textAlign: 'right', width: 40 } }}
                            fullWidth={false}
                          />
                          <IconButton
                            size="small"
                            aria-label={tc('delete')}
                            onClick={() => setPicked((prev) => prev.filter((x) => x.product.id !== item.product.id))}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      }
                    >
                      <ListItemText
                        primary={locale === 'en' && item.product.name_en ? item.product.name_en : item.product.name}
                        secondary={`${item.product.sku}${item.product.primary_barcode ? ` · ${item.product.primary_barcode}` : ''}`}
                        primaryTypographyProps={{ noWrap: true }}
                        sx={{ pr: 12 }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          </GlassCard>
        </Grid>
        <Grid item xs={12} md={7}>
          <GlassCard title={t('preview')} subtitle={tpl ? `${tpl.name} · ${tpl.paper} · ${geo.columns}×${geo.rows}` : t('defaultTemplate')}>
            {sheet.isFetching && <Skeleton variant="rounded" height={200} />}
            {!sheet.isFetching && labels.length === 0 && <Alert severity="info">{t('noPicked')}</Alert>}
            {!sheet.isFetching && labels.length > 0 && (
              <Box sx={{ overflow: 'auto', maxHeight: 640, bgcolor: 'rgba(0,0,0,0.2)', p: 2, borderRadius: 2 }}>
                <LabelSheet pages={pages} geo={geo} locale={locale} />
              </Box>
            )}
          </GlassCard>
        </Grid>
      </Grid>
    </Stack>
  );
}

function LabelSheet({
  pages,
  geo,
  locale,
}: {
  pages: { key: string; sku: string; barcode: string; name: string; price: string }[][];
  geo: Geometry;
  locale: 'th' | 'en';
}) {
  return (
    <Box id="label-sheet">
      {pages.map((page, pi) => (
        <Box
          key={pi}
          className="label-page"
          sx={{
            width: `${geo.pageWidth}mm`,
            boxSizing: 'border-box',
            paddingLeft: `${geo.pageLeft}mm`,
            paddingRight: `${geo.pageLeft}mm`,
            paddingTop: `${geo.pageTop}mm`,
            paddingBottom: `${geo.pageTop}mm`,
            background: '#fff',
            color: '#000',
            mb: 2,
            display: 'grid',
            gridTemplateColumns: `repeat(${geo.columns}, ${geo.labelW}mm)`,
            gridAutoRows: `${geo.labelH}mm`,
            columnGap: `${geo.gapX}mm`,
            rowGap: `${geo.gapY}mm`,
            '@media print': { mb: 0 },
          }}
        >
          {page.map((l) => (
            <Box
              key={l.key}
              sx={{
                boxSizing: 'border-box',
                overflow: 'hidden',
                px: '1.5mm',
                py: '1mm',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                outline: '0.2mm dashed #bbb',
                '@media print': { outline: 'none' },
              }}
            >
              {geo.showName && (
                <Typography sx={{ fontSize: '2.6mm', lineHeight: 1.15, color: '#000', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.name}
                </Typography>
              )}
              {geo.showBarcode && (l.barcode || l.sku) && (
                <Box sx={{ width: '100%', mt: '0.5mm' }}>
                  <Barcode value={l.barcode || l.sku} height={Math.round(geo.barHeight * 4)} fontSize={11} moduleWidth={1} quietZone={6} />
                </Box>
              )}
              <Stack direction="row" justifyContent="space-between" sx={{ width: '100%', mt: '0.5mm' }}>
                {geo.showSku && (
                  <Typography sx={{ fontSize: '2.4mm', color: '#000', fontFamily: 'monospace' }}>{l.sku}</Typography>
                )}
                {geo.showPrice && (
                  <Typography sx={{ fontSize: '3mm', fontWeight: 700, color: '#000' }}>{formatMoney(l.price, locale)}</Typography>
                )}
              </Stack>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
