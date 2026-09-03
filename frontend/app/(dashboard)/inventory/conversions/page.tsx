'use client';

import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { num } from '@/lib/api/hooks/common';
import {
  useConversionRules,
  useConversions,
  usePostConversion,
  useSaveConversionRule,
  useSetConversionRuleActive,
} from '@/lib/api/hooks/inventory';
import type { Product } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';

function ConversionsContent() {
  const t = useTranslations('conversions');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();

  const rules = useConversionRules();
  const docs = useConversions({ page: 1, page_size: 20 });
  const post = usePostConversion();
  const saveRule = useSaveConversionRule();
  const setRuleActive = useSetConversionRuleActive();

  const [from, setFrom] = useState<Product | null>(null);
  const [to, setTo] = useState<Product | null>(null);
  const [factor, setFactor] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');

  // a saved rule fills the factor in as soon as both products are chosen
  const matchedRule = useMemo(
    () => (rules.data ?? []).find((r) => r.is_active && r.from_product_id === from?.id && r.to_product_id === to?.id),
    [rules.data, from?.id, to?.id],
  );
  const effectiveFactor = factor !== '' ? Number(factor) : matchedRule ? num(matchedRule.factor) : 0;
  const resultQty = qty !== '' && effectiveFactor > 0 ? Number(qty) * effectiveFactor : 0;
  const enough = from ? Number(qty || 0) <= num(from.stock_on_hand) : false;
  const canPost = Boolean(from && to && from.id !== to.id && Number(qty) > 0 && effectiveFactor > 0 && enough);

  const submit = () => {
    if (!from || !to) return;
    post.mutate(
      {
        from_product_id: from.id,
        to_product_id: to.id,
        from_qty: qty,
        factor: factor !== '' ? factor : undefined,
        note,
        save_rule: factor !== '' && (!matchedRule || num(matchedRule.factor) !== Number(factor)),
      },
      {
        onSuccess: (doc) => {
          toast.success(t('posted', { doc: doc.doc_no, qty: formatQty(num(doc.to_qty), locale), unit: doc.to_unit ?? '' }));
          setQty('');
          setNote('');
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const addRule = () => {
    if (!from || !to || Number(factor) <= 0) return;
    saveRule.mutate(
      { from_product_id: from.id, to_product_id: to.id, factor, note },
      { onSuccess: () => toast.success(t('ruleSaved')), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 1000 }}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} backHref="/inventory" />

      <GlassCard title={t('convertTitle')} subtitle={t('convertHint')}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
            <Box sx={{ flex: 1, width: '100%' }}>
              <ProductAutocomplete label={t('fromProduct')} value={from} onChange={setFrom} />
            </Box>
            <SwapHorizIcon sx={{ mt: { md: 2 }, alignSelf: { xs: 'center', md: 'flex-start' } }} />
            <Box sx={{ flex: 1, width: '100%' }}>
              <ProductAutocomplete label={t('toProduct')} value={to} onChange={setTo} excludeIds={from ? [from.id] : []} />
            </Box>
          </Stack>

          {from && (
            <Typography variant="body2" color="text.secondary">
              {t('fromStock', { qty: formatQty(num(from.stock_on_hand), locale), unit: from.unit_name ?? '' })}
              {to ? ` · ${t('toStock', { qty: formatQty(num(to.stock_on_hand), locale), unit: to.unit_name ?? '' })}` : ''}
            </Typography>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <GlassInput
              label={t('factor')}
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              placeholder={matchedRule ? String(num(matchedRule.factor)) : '12'}
              helperText={matchedRule ? t('factorFromRule', { factor: String(num(matchedRule.factor)) }) : t('factorHint')}
              inputProps={{ inputMode: 'decimal', 'data-testid': 'conv-factor' }}
              sx={{ maxWidth: 240 }}
            />
            <GlassInput
              label={t('qty')}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputProps={{ inputMode: 'decimal', 'data-testid': 'conv-qty' }}
              sx={{ maxWidth: 200 }}
              error={qty !== '' && !enough}
              helperText={qty !== '' && !enough ? t('notEnough') : undefined}
            />
            <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} sx={{ flex: 1 }} />
          </Stack>

          {resultQty > 0 && to && (
            <Alert severity="info" data-testid="conv-preview">
              {t('preview', {
                fromQty: formatQty(Number(qty), locale),
                fromUnit: from?.unit_name ?? '',
                toQty: formatQty(resultQty, locale),
                toUnit: to.unit_name ?? '',
              })}
            </Alert>
          )}

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <GlassButton startIcon={<SwapHorizIcon />} onClick={submit} disabled={!canPost} loading={post.isPending} data-testid="conv-post">
              {t('convert')}
            </GlassButton>
            <GlassButton
              variant="outlined"
              onClick={addRule}
              disabled={!from || !to || Number(factor) <= 0}
              loading={saveRule.isPending}
              data-testid="conv-save-rule"
            >
              {t('saveRule')}
            </GlassButton>
          </Stack>
        </Stack>
      </GlassCard>

      <GlassCard title={t('rulesTitle')} subtitle={t('rulesHint')}>
        {rules.isPending && <Skeleton variant="rounded" height={140} />}
        {rules.data && rules.data.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('noRules')}
          </Typography>
        )}
        {rules.data && rules.data.length > 0 && (
          <Table size="small" data-testid="conv-rules">
            <TableHead>
              <TableRow>
                <TableCell>{t('fromProduct')}</TableCell>
                <TableCell>{t('toProduct')}</TableCell>
                <TableCell align="right">{t('factorShort')}</TableCell>
                <TableCell align="center">{t('active')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.data.map((r) => (
                <TableRow key={r.id} hover sx={{ opacity: r.is_active ? 1 : 0.55 }}>
                  <TableCell>
                    {r.from_name} <Chip size="small" label={r.from_unit} sx={{ ml: 0.5 }} />
                  </TableCell>
                  <TableCell>
                    {r.to_name} <Chip size="small" label={r.to_unit} sx={{ ml: 0.5 }} />
                  </TableCell>
                  <TableCell align="right">{formatQty(num(r.factor), locale)}</TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={r.is_active}
                      onChange={(e) => setRuleActive.mutate({ id: r.id, is_active: e.target.checked })}
                      inputProps={{ 'aria-label': t('active') } as React.InputHTMLAttributes<HTMLInputElement>}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      <GlassCard title={t('historyTitle')}>
        {docs.isPending && <Skeleton variant="rounded" height={140} />}
        {docs.data && docs.data.items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('noDocs')}
          </Typography>
        )}
        {docs.data && docs.data.items.length > 0 && (
          <Table size="small" data-testid="conv-docs">
            <TableHead>
              <TableRow>
                <TableCell>{t('docNo')}</TableCell>
                <TableCell>{tc('date')}</TableCell>
                <TableCell>{t('what')}</TableCell>
                <TableCell align="right">{t('value')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {docs.data.items.map((d) => (
                <TableRow key={d.id} hover>
                  <TableCell>{d.doc_no}</TableCell>
                  <TableCell>{formatDateTime(d.converted_at)}</TableCell>
                  <TableCell>
                    {formatQty(num(d.from_qty), locale)} {d.from_unit} {d.from_name}
                    <Divider flexItem orientation="vertical" sx={{ mx: 1, display: 'inline-block', height: 12 }} />→{' '}
                    {formatQty(num(d.to_qty), locale)} {d.to_unit} {d.to_name}
                  </TableCell>
                  <TableCell align="right">{formatMoney(num(d.total_cost), locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>
    </Stack>
  );
}

export default function ConversionsPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <ConversionsContent />
    </RequireAuth>
  );
}
