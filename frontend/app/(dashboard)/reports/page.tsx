'use client';

import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState, type ReactNode } from 'react';
import DateRangeFilter, { monthRange, type DateRange } from '@/components/DateRangeFilter';
import MemberAutocomplete from '@/components/MemberAutocomplete';
import PageHeader from '@/components/PageHeader';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import StatTile from '@/components/StatTile';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale, type Locale } from '@/i18n/config';
import { api } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { num } from '@/lib/api/hooks/common';
import type { Member } from '@/lib/api/hooks/members';
import { useCategories, useSuppliers, type Product } from '@/lib/api/hooks/products';
import {
  downloadReportCsv,
  useReport,
  type ARAgingReport,
  type ARStatement,
  type CashierSales,
  type CategorySales,
  type DailySales,
  type DeadStock,
  type ExpensesSummary,
  type HourlySales,
  type InventoryStatus,
  type MonthlyChart,
  type ProductMovement,
  type ProductSales,
  type ProfitLoss,
  type Purchases,
  type ReportParams,
  type SupplierPurchases,
} from '@/lib/api/hooks/reports';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { today } from '@/lib/dates';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty } from '@/lib/format';

// ---------------------------------------------------------------------------
// Generic table helpers
// ---------------------------------------------------------------------------

type Fmt = 'money' | 'qty' | 'int' | 'date' | 'datetime' | 'pct' | 'text';
type Row = Record<string, unknown>;

interface Col {
  key: string;
  label: string;
  fmt?: Fmt;
  width?: number;
  render?: (row: Row) => ReactNode;
}

function fmtValue(value: unknown, fmt: Fmt | undefined, locale: Locale): ReactNode {
  if (value === null || value === undefined || value === '') return fmt === 'text' || !fmt ? '' : '-';
  switch (fmt) {
    case 'money':
      return formatMoney(value as string, locale);
    case 'qty':
      return formatQty(value as string, locale);
    case 'int':
      return formatQty(value as number, locale, 0);
    case 'pct':
      return `${formatNumber(value as string, locale, 2)}%`;
    case 'date':
      return formatDate(value as string, locale);
    case 'datetime':
      return formatDateTime(value as string, locale);
    default:
      return String(value);
  }
}

const NUMERIC: Fmt[] = ['money', 'qty', 'int', 'pct'];

function ReportTable({ cols, rows, total, loading, locale, empty, keyOf }: { cols: Col[]; rows: Row[]; total?: Row | null; loading: boolean; locale: Locale; empty: string; keyOf?: (r: Row, i: number) => string }) {
  const columns: GlassColumn<Row>[] = cols.map((c) => ({
    key: c.key,
    label: c.label,
    width: c.width,
    align: c.fmt && NUMERIC.includes(c.fmt) ? 'right' : 'left',
    render: (r) => (c.render ? c.render(r) : r.__total ? <strong>{fmtValue(r[c.key], c.fmt, locale)}</strong> : fmtValue(r[c.key], c.fmt, locale)),
  }));
  const all = total && rows.length > 0 ? [...rows, { ...total, __total: true }] : rows;
  return <GlassTable columns={columns} rows={all} rowKey={(r, i) => (r.__total ? '__total' : keyOf ? keyOf(r, i) : String(i))} loading={loading} emptyText={empty} maxHeight="70vh" />;
}

function ExportButton({ name, params }: { name: string; params: ReportParams }) {
  const t = useTranslations('reports');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const dl = useMutation({ mutationFn: () => downloadReportCsv(name, params), onError: (err) => toast.error(errorMessage(err)) });
  return (
    <GlassButton variant="outlined" startIcon={<DownloadIcon />} loading={dl.isPending} onClick={() => dl.mutate()}>
      {t('exportCsv')}
    </GlassButton>
  );
}

function GroupSelect({ value, onChange }: { value: 'day' | 'month'; onChange: (v: 'day' | 'month') => void }) {
  const t = useTranslations('reports');
  return (
    <GlassInput select size="small" label={t('groupBy')} value={value} onChange={(e) => onChange(e.target.value as 'day' | 'month')} sx={{ width: 140 }} fullWidth={false}>
      <MenuItem value="day">{t('groups.day')}</MenuItem>
      <MenuItem value="month">{t('groups.month')}</MenuItem>
    </GlassInput>
  );
}

function CategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale();
  const categories = useCategories();
  return (
    <GlassInput select size="small" label={t('cols.category')} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 180 }} fullWidth={false} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
      <MenuItem value="">{tc('all')}</MenuItem>
      {(categories.data ?? []).map((c) => (
        <MenuItem key={c.id} value={c.id}>
          {locale === 'en' && c.name_en ? c.name_en : c.name}
        </MenuItem>
      ))}
    </GlassInput>
  );
}

const rangeParams = (r: DateRange): ReportParams => ({ from: r.from || undefined, to: r.to || undefined });

// ---------------------------------------------------------------------------
// Individual reports
// ---------------------------------------------------------------------------

type RangeProps = { range: DateRange; locale: Locale };

function DailySalesReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const [group, setGroup] = useState<'day' | 'month'>('day');
  const params = { ...rangeParams(range), group };
  const q = useReport<DailySales>('daily-sales', params);
  const cols: Col[] = [
    { key: 'date', label: t('cols.date'), width: 120 },
    { key: 'bills', label: t('cols.bills'), fmt: 'int', width: 80 },
    { key: 'gross', label: t('cols.gross'), fmt: 'money' },
    { key: 'discount', label: t('cols.discount'), fmt: 'money' },
    { key: 'net', label: t('cols.net'), fmt: 'money' },
    { key: 'cancelled', label: t('cols.cancelled'), fmt: 'int', width: 80 },
    { key: 'cash', label: t('cols.cash'), fmt: 'money' },
    { key: 'credit', label: t('cols.credit'), fmt: 'money' },
    { key: 'transfer', label: t('cols.transfer'), fmt: 'money' },
    { key: 'card', label: t('cols.card'), fmt: 'money' },
    { key: 'qr', label: t('cols.qr'), fmt: 'money' },
    { key: 'cost', label: t('cols.cost'), fmt: 'money' },
    { key: 'margin', label: t('cols.margin'), fmt: 'money' },
    { key: 'margin_pct', label: t('cols.marginPct'), fmt: 'pct', width: 90 },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <GroupSelect value={group} onChange={setGroup} />
        <ExportButton name="daily-sales" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={q.data?.total as unknown as Row} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.date)} />
    </Stack>
  );
}

function SalesByProductReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<'net' | 'qty' | 'margin'>('net');
  const [limit, setLimit] = useState('200');
  const params = { ...rangeParams(range), category_id: categoryId || undefined, sort, limit: Number(limit) || 200 };
  const q = useReport<ProductSales>('sales-by-product', params);
  const cols: Col[] = [
    { key: 'sku', label: t('cols.sku'), width: 120 },
    { key: 'name', label: t('cols.product') },
    { key: 'category', label: t('cols.category'), width: 140 },
    { key: 'unit', label: t('cols.unit'), width: 80 },
    { key: 'qty', label: t('cols.qty'), fmt: 'qty', width: 100 },
    { key: 'gross', label: t('cols.gross'), fmt: 'money' },
    { key: 'discount', label: t('cols.discount'), fmt: 'money' },
    { key: 'net', label: t('cols.net'), fmt: 'money' },
    { key: 'cost', label: t('cols.cost'), fmt: 'money' },
    { key: 'margin', label: t('cols.margin'), fmt: 'money' },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <CategorySelect value={categoryId} onChange={setCategoryId} />
        <GlassInput select size="small" label={t('sort')} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} sx={{ width: 150 }} fullWidth={false}>
          <MenuItem value="net">{t('sorts.net')}</MenuItem>
          <MenuItem value="qty">{t('sorts.qty')}</MenuItem>
          <MenuItem value="margin">{t('sorts.margin')}</MenuItem>
        </GlassInput>
        <GlassInput size="small" label={t('limit')} value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} sx={{ width: 100 }} fullWidth={false} inputProps={{ inputMode: 'numeric' }} />
        <ExportButton name="sales-by-product" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={q.data?.total as unknown as Row} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r, i) => `${r.product_id ?? r.sku ?? i}`} />
    </Stack>
  );
}

function SalesByCategoryReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const params = rangeParams(range);
  const q = useReport<CategorySales>('sales-by-category', params);
  const cols: Col[] = [
    { key: 'category', label: t('cols.category') },
    { key: 'bills', label: t('cols.bills'), fmt: 'int', width: 80 },
    { key: 'qty', label: t('cols.qty'), fmt: 'qty', width: 100 },
    { key: 'gross', label: t('cols.gross'), fmt: 'money' },
    { key: 'discount', label: t('cols.discount'), fmt: 'money' },
    { key: 'net', label: t('cols.net'), fmt: 'money' },
    { key: 'cost', label: t('cols.cost'), fmt: 'money' },
    { key: 'margin', label: t('cols.margin'), fmt: 'money' },
    { key: 'margin_pct', label: t('cols.marginPct'), fmt: 'pct', width: 90 },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row">
        <ExportButton name="sales-by-category" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={q.data?.total as unknown as Row} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r, i) => `${r.category_id ?? i}`} />
    </Stack>
  );
}

function SalesByCashierReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const params = rangeParams(range);
  const q = useReport<CashierSales>('sales-by-cashier', params);
  const cols: Col[] = [
    { key: 'cashier', label: t('cols.cashier') },
    { key: 'bills', label: t('cols.bills'), fmt: 'int', width: 100 },
    { key: 'net', label: t('cols.net'), fmt: 'money' },
    { key: 'cancelled', label: t('cols.cancelled'), fmt: 'int', width: 100 },
    { key: 'avg_bill', label: t('cols.avgBill'), fmt: 'money' },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row">
        <ExportButton name="sales-by-cashier" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={q.data?.total as unknown as Row} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r, i) => `${r.cashier_id ?? i}`} />
    </Stack>
  );
}

function SalesByHourReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const params = rangeParams(range);
  const q = useReport<HourlySales>('sales-by-hour', params);
  const max = Math.max(1, ...(q.data?.rows ?? []).map((r) => num(r.net)));
  const cols: Col[] = [
    { key: 'hour', label: t('cols.hour'), width: 100, render: (r) => `${String(r.hour).padStart(2, '0')}:00` },
    { key: 'bills', label: t('cols.bills'), fmt: 'int', width: 100 },
    { key: 'net', label: t('cols.net'), fmt: 'money', width: 160 },
    {
      key: 'bar',
      label: '',
      render: (r) => (
        <Stack sx={{ height: 10, borderRadius: 1, width: `${(num(r.net as string) / max) * 100}%`, minWidth: num(r.net as string) > 0 ? 4 : 0, backgroundImage: (th) => th.glass.gradient }} />
      ),
    },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row">
        <ExportButton name="sales-by-hour" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.hour)} />
    </Stack>
  );
}

function ProductMovementReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const ti = useTranslations('inventory');
  const [product, setProduct] = useState<Product | null>(null);
  const params = { ...rangeParams(range), product_id: product?.id };
  const q = useReport<ProductMovement>('product-movement', params, Boolean(product));
  const cols: Col[] = [
    { key: 'at', label: t('cols.date'), fmt: 'datetime', width: 160 },
    { key: 'type', label: t('cols.type'), width: 140, render: (r) => (ti.has(`moveTypes.${r.type}`) ? ti(`moveTypes.${r.type}`) : String(r.type)) },
    { key: 'doc_no', label: t('cols.docNo'), width: 140 },
    { key: 'qty_delta', label: ti('qtyDelta'), fmt: 'qty', width: 100 },
    { key: 'unit_cost', label: ti('unitCost'), fmt: 'money', width: 120 },
    { key: 'balance', label: t('cols.balance'), fmt: 'qty', width: 100 },
    { key: 'by', label: t('cols.by'), width: 140 },
    { key: 'note', label: t('cols.note') },
  ];
  const d = q.data;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Stack sx={{ minWidth: 320, flex: 1, maxWidth: 520 }}>
          <ProductAutocomplete value={product} onChange={setProduct} size="small" label={t('selectProduct')} />
        </Stack>
        {product && <ExportButton name="product-movement" params={params} />}
      </Stack>
      {!product && <Typography color="text.secondary">{t('selectProductHint')}</Typography>}
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      {d && (
        <Grid container spacing={2}>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.openingBalance')} value={formatQty(d.opening_balance, locale)} />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.in')} value={formatQty(d.in, locale)} color="success.main" />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.out')} value={formatQty(d.out, locale)} color="error.main" />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.closingBalance')} value={formatQty(d.closing_balance, locale)} />
          </Grid>
        </Grid>
      )}
      {product && <ReportTable cols={cols} rows={(d?.rows ?? []) as unknown as Row[]} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.id)} />}
    </Stack>
  );
}

function InventoryTotalsTiles({ total, locale }: { total?: { products: number; units: string | number; cost_value: string | number; retail_value: string | number } | null; locale: Locale }) {
  const t = useTranslations('reports');
  if (!total) return null;
  return (
    <Grid container spacing={2}>
      <Grid item xs={6} md={3}>
        <StatTile label={t('cols.products')} value={formatQty(total.products, locale, 0)} />
      </Grid>
      <Grid item xs={6} md={3}>
        <StatTile label={t('cols.units')} value={formatQty(total.units, locale)} />
      </Grid>
      <Grid item xs={6} md={3}>
        <StatTile label={t('cols.costValue')} value={formatMoney(total.cost_value, locale)} />
      </Grid>
      <Grid item xs={6} md={3}>
        <StatTile label={t('cols.retailValue')} value={formatMoney(total.retail_value, locale)} />
      </Grid>
    </Grid>
  );
}

function InventoryStatusReport({ locale }: { locale: Locale }) {
  const t = useTranslations('reports');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [belowMin, setBelowMin] = useState(false);
  const [zero, setZero] = useState(false);
  const [negative, setNegative] = useState(false);
  const params = { category_id: categoryId || undefined, q: search.trim() || undefined, below_min: belowMin || undefined, zero: zero || undefined, negative: negative || undefined };
  const q = useReport<InventoryStatus>('inventory-status', params);
  const cols: Col[] = [
    { key: 'sku', label: t('cols.sku'), width: 120 },
    { key: 'name', label: t('cols.product') },
    { key: 'category', label: t('cols.category'), width: 140 },
    { key: 'unit', label: t('cols.unit'), width: 80 },
    { key: 'stock', label: t('cols.stock'), fmt: 'qty', width: 100 },
    { key: 'min_level1', label: t('cols.minLevel1'), fmt: 'qty', width: 90 },
    { key: 'min_level2', label: t('cols.minLevel2'), fmt: 'qty', width: 90 },
    { key: 'cost_avg', label: t('cols.costAvg'), fmt: 'money', width: 110 },
    { key: 'sell_price', label: t('cols.sellPrice'), fmt: 'money', width: 110 },
    { key: 'stock_value', label: t('cols.stockValue'), fmt: 'money', width: 120 },
    { key: 'last_sold_at', label: t('cols.lastSoldAt'), fmt: 'date', width: 120 },
    { key: 'last_received_at', label: t('cols.lastReceivedAt'), fmt: 'date', width: 120 },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <GlassInput size="small" label={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 220 }} fullWidth={false} />
        <CategorySelect value={categoryId} onChange={setCategoryId} />
        <FormControlLabel control={<Switch checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} />} label={t('belowMin')} />
        <FormControlLabel control={<Switch checked={zero} onChange={(e) => setZero(e.target.checked)} />} label={t('zeroStock')} />
        <FormControlLabel control={<Switch checked={negative} onChange={(e) => setNegative(e.target.checked)} />} label={t('negativeStock')} />
        <ExportButton name="inventory-status" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <InventoryTotalsTiles total={q.data?.total} locale={locale} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.product_id)} />
    </Stack>
  );
}

function DeadStockReport({ locale }: { locale: Locale }) {
  const t = useTranslations('reports');
  const [days, setDays] = useState('90');
  const [categoryId, setCategoryId] = useState('');
  const params = { days: Number(days) || 90, category_id: categoryId || undefined };
  const q = useReport<DeadStock>('dead-stock', params);
  const cols: Col[] = [
    { key: 'sku', label: t('cols.sku'), width: 120 },
    { key: 'name', label: t('cols.product') },
    { key: 'category', label: t('cols.category'), width: 140 },
    { key: 'unit', label: t('cols.unit'), width: 80 },
    { key: 'stock', label: t('cols.stock'), fmt: 'qty', width: 100 },
    { key: 'cost_avg', label: t('cols.costAvg'), fmt: 'money', width: 110 },
    { key: 'stock_value', label: t('cols.stockValue'), fmt: 'money', width: 120 },
    { key: 'last_sold_at', label: t('cols.lastSoldAt'), fmt: 'date', width: 130 },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <GlassInput size="small" label={t('deadStockDays')} value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} sx={{ width: 140 }} fullWidth={false} inputProps={{ inputMode: 'numeric' }} />
        <CategorySelect value={categoryId} onChange={setCategoryId} />
        {q.data && (
          <Typography variant="body2" color="text.secondary">
            {t('sinceDate', { date: formatDate(q.data.since, locale) })}
          </Typography>
        )}
        <ExportButton name="dead-stock" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <InventoryTotalsTiles total={q.data?.total} locale={locale} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.product_id)} />
    </Stack>
  );
}

function ARAgingReportView({ locale }: { locale: Locale }) {
  const t = useTranslations('reports');
  const [asOf, setAsOf] = useState(today());
  const params = { as_of: asOf };
  const q = useReport<ARAgingReport>('ar-aging', params);
  const cols: Col[] = [
    { key: 'member_code', label: t('cols.memberCode'), width: 110 },
    { key: 'name', label: t('cols.member') },
    { key: 'phone', label: t('cols.phone'), width: 130 },
    { key: 'bills', label: t('cols.bills'), fmt: 'int', width: 80 },
    { key: 'balance', label: t('cols.balance'), fmt: 'money' },
    { key: 'b0_30', label: '0-30', fmt: 'money' },
    { key: 'b31_60', label: '31-60', fmt: 'money' },
    { key: 'b61_90', label: '61-90', fmt: 'money' },
    { key: 'b90_plus', label: '90+', fmt: 'money' },
    { key: 'oldest_due', label: t('cols.oldestDue'), fmt: 'date', width: 120 },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <GlassInput type="date" size="small" label={t('asOf')} value={asOf} onChange={(e) => setAsOf(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 180 }} fullWidth={false} />
        <ExportButton name="ar-aging" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={q.data?.total as unknown as Row} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.member_id)} />
    </Stack>
  );
}

function ARStatementReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const ta = useTranslations('ar');
  const [member, setMember] = useState<Member | null>(null);
  const params = { ...rangeParams(range), member_id: member?.id };
  const q = useReport<ARStatement>('ar-statement', params, Boolean(member));
  const cols: Col[] = [
    { key: 'at', label: t('cols.date'), fmt: 'datetime', width: 160 },
    { key: 'kind', label: t('cols.type'), width: 110, render: (r) => t(`kinds.${r.kind as string}`) },
    { key: 'doc_no', label: t('cols.docNo'), width: 140 },
    { key: 'sale_doc_no', label: ta('bill'), width: 140 },
    { key: 'debit', label: t('cols.debit'), fmt: 'money' },
    { key: 'credit', label: t('cols.creditAmount'), fmt: 'money' },
    { key: 'balance', label: t('cols.balance'), fmt: 'money' },
    { key: 'method', label: ta('method'), width: 100, render: (r) => (r.method && ta.has(`methods.${r.method as string}`) ? ta(`methods.${r.method as string}`) : String(r.method ?? '')) },
    { key: 'note', label: t('cols.note') },
  ];
  const d = q.data;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Stack sx={{ minWidth: 320, flex: 1, maxWidth: 520 }}>
          <MemberAutocomplete value={member} onChange={setMember} size="small" label={t('selectMember')} />
        </Stack>
        {member && <ExportButton name="ar-statement" params={params} />}
      </Stack>
      {!member && <Typography color="text.secondary">{t('selectMemberHint')}</Typography>}
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      {d && (
        <Grid container spacing={2}>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.openingBalance')} value={formatMoney(d.opening_balance, locale)} />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.charges')} value={formatMoney(d.charges, locale)} color="error.main" />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.payments')} value={formatMoney(d.payments, locale)} color="success.main" />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile label={t('cols.closingBalance')} value={formatMoney(d.closing_balance, locale)} />
          </Grid>
        </Grid>
      )}
      {member && <ReportTable cols={cols} rows={(d?.rows ?? []) as unknown as Row[]} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => `${r.kind}-${r.id}`} />}
    </Stack>
  );
}

function SupplierPurchasesReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const params = rangeParams(range);
  const q = useReport<SupplierPurchases>('supplier-purchases', params);
  const cols: Col[] = [
    { key: 'supplier', label: t('cols.supplier') },
    { key: 'receipts', label: t('cols.receipts'), fmt: 'int', width: 120 },
    { key: 'total', label: t('cols.total'), fmt: 'money', width: 160 },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row">
        <ExportButton name="supplier-purchases" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={q.data?.total as unknown as Row} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r, i) => `${r.supplier_id ?? i}`} />
    </Stack>
  );
}

function PurchasesReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const ti = useTranslations('inventory');
  const tc = useTranslations('common');
  const [supplierId, setSupplierId] = useState('');
  const suppliers = useSuppliers();
  const params = { ...rangeParams(range), supplier_id: supplierId || undefined };
  const q = useReport<Purchases>('purchases', params);
  const cols: Col[] = [
    { key: 'doc_no', label: t('cols.docNo'), width: 140 },
    { key: 'received_at', label: t('cols.receivedAt'), fmt: 'datetime', width: 160 },
    { key: 'supplier', label: t('cols.supplier') },
    { key: 'supplier_ref', label: t('cols.supplierRef'), width: 130 },
    { key: 'received_by', label: t('cols.receivedBy'), width: 130 },
    { key: 'status', label: t('cols.status'), width: 100, render: (r) => (r.status ? (ti.has(`statuses.${r.status}`) ? ti(`statuses.${r.status}`) : String(r.status)) : '') },
    { key: 'lines', label: t('cols.lines'), fmt: 'int', width: 70 },
    { key: 'qty', label: t('cols.qty'), fmt: 'qty', width: 90 },
    { key: 'subtotal', label: t('cols.subtotal'), fmt: 'money' },
    { key: 'vat', label: t('cols.vat'), fmt: 'money', width: 110 },
    { key: 'total', label: t('cols.total'), fmt: 'money' },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <GlassInput select size="small" label={t('cols.supplier')} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} sx={{ minWidth: 200 }} fullWidth={false} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
          <MenuItem value="">{tc('all')}</MenuItem>
          {(suppliers.data ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </GlassInput>
        <ExportButton name="purchases" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={q.data?.total as unknown as Row} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.id)} />
    </Stack>
  );
}

function ExpensesSummaryReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const [group, setGroup] = useState<'day' | 'month'>('month');
  const params = { ...rangeParams(range), group };
  const q = useReport<ExpensesSummary>('expenses-summary', params);
  const byType: Col[] = [
    { key: 'type', label: t('cols.expenseType') },
    { key: 'count', label: t('cols.count'), fmt: 'int', width: 100 },
    { key: 'amount', label: t('cols.amount'), fmt: 'money', width: 160 },
  ];
  const perPeriod: Col[] = [{ key: 'period', label: t('cols.date'), width: 120 }, ...byType];
  const total = q.data ? { type: t('cols.total'), count: q.data.count, amount: q.data.total } : null;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <GroupSelect value={group} onChange={setGroup} />
        <ExportButton name="expenses-summary" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            {t('byType')}
          </Typography>
          <ReportTable cols={byType} rows={(q.data?.by_type ?? []) as unknown as Row[]} total={total as Row | null} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r, i) => `${r.type_id ?? i}`} />
        </Grid>
        <Grid item xs={12} md={7}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            {t('perPeriod')}
          </Typography>
          <ReportTable cols={perPeriod} rows={(q.data?.rows ?? []) as unknown as Row[]} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r, i) => `${r.period}-${r.type_id ?? i}`} />
        </Grid>
      </Grid>
    </Stack>
  );
}

function ProfitLossReport({ range, locale }: RangeProps) {
  const t = useTranslations('reports');
  const params = rangeParams(range);
  const q = useReport<ProfitLoss>('profit-loss', params);
  const d = q.data;
  const line = (label: string, value: ReactNode, strong = false, color?: string) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.75, borderBottom: (th) => `1px solid ${th.glass.border}` }}>
      <Typography variant="body2" fontWeight={strong ? 700 : 400}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={strong ? 700 : 400} color={color}>
        {value}
      </Typography>
    </Stack>
  );
  const expenseCols: Col[] = [
    { key: 'type', label: t('cols.expenseType') },
    { key: 'count', label: t('cols.count'), fmt: 'int', width: 90 },
    { key: 'amount', label: t('cols.amount'), fmt: 'money', width: 150 },
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row">
        <ExportButton name="profit-loss" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      {d && (
        <>
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}>
              <StatTile label={t('cols.netRevenue')} value={formatMoney(d.net_revenue, locale)} hint={`${t('cols.bills')}: ${d.bills}`} />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile label={t('grossProfit')} value={formatMoney(d.gross_profit, locale)} hint={`${formatNumber(d.margin_pct, locale)}%`} />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile label={t('cols.expensesTotal')} value={formatMoney(d.expenses_total, locale)} color="error.main" />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile label={t('netProfit')} value={formatMoney(d.net_profit, locale)} color={num(d.net_profit) < 0 ? 'error.main' : 'success.main'} />
            </Grid>
          </Grid>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <GlassCard title={t('profitLoss')}>
                {line(t('cols.grossSales'), formatMoney(d.gross_sales, locale))}
                {line(t('cols.discounts'), `- ${formatMoney(d.discounts, locale)}`)}
                {line(t('cols.netSales'), formatMoney(d.net_sales, locale), true)}
                {line(`${t('cols.returnsRefunded')} (${d.returns_count})`, `- ${formatMoney(d.returns_refunded, locale)}`)}
                {line(t('cols.netRevenue'), formatMoney(d.net_revenue, locale), true)}
                {line(t('cols.costOfGoods'), `- ${formatMoney(d.cost_of_goods, locale)}`)}
                {line(t('grossProfit'), formatMoney(d.gross_profit, locale), true)}
                {line(t('cols.expensesTotal'), `- ${formatMoney(d.expenses_total, locale)}`)}
                {line(t('netProfit'), formatMoney(d.net_profit, locale), true, num(d.net_profit) < 0 ? 'error.main' : 'success.main')}
              </GlassCard>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                {t('cols.expenses')}
              </Typography>
              <ReportTable cols={expenseCols} rows={(d.expenses ?? []) as unknown as Row[]} loading={false} locale={locale} empty={t('noRows')} keyOf={(r, i) => `${r.type_id ?? i}`} />
            </Grid>
          </Grid>
        </>
      )}
    </Stack>
  );
}

function MonthlyChartReport({ locale }: { locale: Locale }) {
  const t = useTranslations('reports');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const qc = useQueryClient();
  const { hasRole } = useSession();
  const canRefresh = hasRole(...MUTATING_ROLES);
  const thisYear = dayjs().year();
  const [year, setYear] = useState(thisYear);
  const params = { year };
  const q = useReport<MonthlyChart>('monthly-chart', params);
  const refresh = useMutation({
    mutationFn: () => api.post<{ refreshed_at: string }>('/reports/monthly-chart/refresh'),
    onSuccess: () => {
      toast.success(t('refreshed'));
      void qc.invalidateQueries({ queryKey: ['reports', 'monthly-chart'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const max = Math.max(1, ...(q.data?.rows ?? []).map((r) => num(r.net)));
  const cols: Col[] = [
    { key: 'month', label: t('cols.month'), width: 140, render: (r) => String(locale === 'th' ? r.month_name_th : r.month_name_en) },
    { key: 'bills', label: t('cols.bills'), fmt: 'int', width: 100 },
    { key: 'net', label: t('cols.net'), fmt: 'money', width: 160 },
    {
      key: 'bar',
      label: '',
      render: (r) =>
        r.__total ? null : (
          <Stack sx={{ height: 10, borderRadius: 1, width: `${(num(r.net as string) / max) * 100}%`, minWidth: num(r.net as string) > 0 ? 4 : 0, backgroundImage: (th) => th.glass.gradient }} />
        ),
    },
  ];
  const total = q.data ? { month_name_th: t('cols.total'), month_name_en: t('cols.total'), bills: q.data.bills, net: q.data.net } : null;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <GlassInput select size="small" label={t('cols.year')} value={String(year)} onChange={(e) => setYear(Number(e.target.value))} sx={{ width: 140 }} fullWidth={false}>
          {Array.from({ length: 8 }, (_, i) => thisYear - i).map((y) => (
            <MenuItem key={y} value={String(y)}>
              {locale === 'th' ? y + 543 : y}
            </MenuItem>
          ))}
        </GlassInput>
        {q.data && (
          <Typography variant="body2" color="text.secondary">
            {t('source')}: {q.data.source}
          </Typography>
        )}
        {canRefresh && (
          <GlassButton variant="outlined" startIcon={<RefreshIcon />} loading={refresh.isPending} onClick={() => refresh.mutate()}>
            {t('refreshChart')}
          </GlassButton>
        )}
        <ExportButton name="monthly-chart" params={params} />
      </Stack>
      <QueryError error={q.error} onRetry={() => q.refetch()} />
      <ReportTable cols={cols} rows={(q.data?.rows ?? []) as unknown as Row[]} total={total as Row | null} loading={q.isPending} locale={locale} empty={t('noRows')} keyOf={(r) => String(r.month_index)} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type TabKey =
  | 'daily-sales'
  | 'sales-by-product'
  | 'sales-by-category'
  | 'sales-by-cashier'
  | 'sales-by-hour'
  | 'product-movement'
  | 'inventory-status'
  | 'dead-stock'
  | 'ar-aging'
  | 'ar-statement'
  | 'supplier-purchases'
  | 'purchases'
  | 'expenses-summary'
  | 'profit-loss'
  | 'monthly-chart';

const TABS: { key: TabKey; label: string; ranged: boolean }[] = [
  { key: 'daily-sales', label: 'dailySales', ranged: true },
  { key: 'sales-by-product', label: 'salesByProduct', ranged: true },
  { key: 'sales-by-category', label: 'salesByCategory', ranged: true },
  { key: 'sales-by-cashier', label: 'salesByCashier', ranged: true },
  { key: 'sales-by-hour', label: 'salesByHour', ranged: true },
  { key: 'profit-loss', label: 'profitLoss', ranged: true },
  { key: 'expenses-summary', label: 'expenseSummary', ranged: true },
  { key: 'product-movement', label: 'productMovement', ranged: true },
  { key: 'inventory-status', label: 'inventoryStatus', ranged: false },
  { key: 'dead-stock', label: 'deadStock', ranged: false },
  { key: 'ar-aging', label: 'arAging', ranged: false },
  { key: 'ar-statement', label: 'arStatement', ranged: true },
  { key: 'supplier-purchases', label: 'supplierPurchases', ranged: true },
  { key: 'purchases', label: 'purchases', ranged: true },
  { key: 'monthly-chart', label: 'monthlyChart', ranged: false },
];

function ReportsContent() {
  const t = useTranslations('reports');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const search = useSearchParams();
  const requested = search?.get('tab') as TabKey | null;
  const tab: TabKey = requested && TABS.some((x) => x.key === requested) ? requested : 'daily-sales';
  const [range, setRange] = useState<DateRange>(monthRange());
  const def = useMemo(() => TABS.find((x) => x.key === tab)!, [tab]);

  const body = (() => {
    switch (tab) {
      case 'daily-sales':
        return <DailySalesReport range={range} locale={locale} />;
      case 'sales-by-product':
        return <SalesByProductReport range={range} locale={locale} />;
      case 'sales-by-category':
        return <SalesByCategoryReport range={range} locale={locale} />;
      case 'sales-by-cashier':
        return <SalesByCashierReport range={range} locale={locale} />;
      case 'sales-by-hour':
        return <SalesByHourReport range={range} locale={locale} />;
      case 'product-movement':
        return <ProductMovementReport range={range} locale={locale} />;
      case 'inventory-status':
        return <InventoryStatusReport locale={locale} />;
      case 'dead-stock':
        return <DeadStockReport locale={locale} />;
      case 'ar-aging':
        return <ARAgingReportView locale={locale} />;
      case 'ar-statement':
        return <ARStatementReport range={range} locale={locale} />;
      case 'supplier-purchases':
        return <SupplierPurchasesReport range={range} locale={locale} />;
      case 'purchases':
        return <PurchasesReport range={range} locale={locale} />;
      case 'expenses-summary':
        return <ExpensesSummaryReport range={range} locale={locale} />;
      case 'profit-loss':
        return <ProfitLossReport range={range} locale={locale} />;
      case 'monthly-chart':
        return <MonthlyChartReport locale={locale} />;
      default:
        return null;
    }
  })();

  return (
    <Stack spacing={3}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs value={tab} onChange={(_, v: TabKey) => router.replace(`/reports?tab=${v}`)} variant="scrollable" allowScrollButtonsMobile>
        {TABS.map((x) => (
          <Tab key={x.key} value={x.key} label={t(x.label)} />
        ))}
      </Tabs>
      {def.ranged && <DateRangeFilter value={range} onChange={setRange} />}
      {body}
    </Stack>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsContent />
    </Suspense>
  );
}
