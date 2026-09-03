'use client';

import AddIcon from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import { useToast } from '@/components/Toast';
import { DIVIDEND_STATUS_COLOR as STATUS_COLOR } from '@/components/dividends/status';
import { GlassButton, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import { useCreatePeriod, usePeriods, type PeriodSummary } from '@/lib/api/hooks/dividends';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { currentBEYear } from '@/lib/dates';
import { formatDate, formatMoney } from '@/lib/format';

function CreatePeriodDialog({ open, periods, onClose, onCreated }: { open: boolean; periods: PeriodSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations('dividends');
  const tc = useTranslations('common');
  const errorMessage = useApiErrorMessage();
  const create = useCreatePeriod();
  const [beYear, setBeYear] = useState(String(currentBEYear()));
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [netProfit, setNetProfit] = useState('');
  const [note, setNote] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const latest = periods[0];
    const year = latest ? latest.be_year + 1 : currentBEYear();
    setBeYear(String(year));
    setNetProfit('');
    setNote('');
    setCopyFrom(latest?.id ?? '');
    setFormError(null);
  }, [open, periods]);

  // Default the range to the Gregorian calendar year of the BE year.
  useEffect(() => {
    const y = Number(beYear) - 543;
    if (Number.isFinite(y) && y > 1900) {
      setStartsOn(`${y}-01-01`);
      setEndsOn(`${y}-12-31`);
    }
  }, [beYear]);

  const valid = /^\d{4}$/.test(beYear) && netProfit !== '' && num(netProfit) >= 0;

  const submit = () => {
    setFormError(null);
    create.mutate(
      {
        be_year: Number(beYear),
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        net_profit: decStr(netProfit),
        note: note.trim(),
        copy_criteria_from_period_id: copyFrom || null,
      },
      { onSuccess: (p) => onCreated(p.id), onError: (err) => setFormError(errorMessage(err)) },
    );
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={create.isPending}
      maxWidth="xs"
      title={t('newPeriod')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={create.isPending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton onClick={submit} loading={create.isPending} disabled={!valid}>
            {tc('create')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <GlassInput label={t('beYear')} value={beYear} onChange={(e) => setBeYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputProps={{ inputMode: 'numeric' }} autoFocus />
        <Stack direction="row" spacing={2}>
          <GlassInput type="date" label={t('periodStart')} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} InputLabelProps={{ shrink: true }} />
          <GlassInput type="date" label={t('periodEnd')} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Stack>
        <MoneyField label={t('netProfit')} value={netProfit} onChange={setNetProfit} helperText={t('netProfitHint')} />
        <GlassInput select label={t('copyCriteriaFrom')} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
          <MenuItem value="">
            <em>{t('defaultCriteria')}</em>
          </MenuItem>
          {periods.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {t('beYear')} {p.be_year}
            </MenuItem>
          ))}
        </GlassInput>
        <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
      </Stack>
    </GlassDialog>
  );
}

export default function DividendsPage() {
  const t = useTranslations('dividends');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const toast = useToast();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const periods = usePeriods();
  const [open, setOpen] = useState(false);

  const columns: GlassColumn<PeriodSummary>[] = [
    {
      key: 'be_year',
      label: t('beYear'),
      width: 110,
      render: (p) => (
        <Typography variant="body2" fontWeight={700}>
          {p.be_year}
        </Typography>
      ),
    },
    { key: 'range', label: t('dividendPeriod'), width: 220, render: (p) => `${formatDate(p.starts_on, locale)} – ${formatDate(p.ends_on, locale)}` },
    {
      key: 'status',
      label: t('status'),
      width: 130,
      render: (p) => <Chip size="small" color={STATUS_COLOR[p.status] ?? 'default'} label={t.has(`statuses.${p.status}`) ? t(`statuses.${p.status}`) : p.status} />,
    },
    { key: 'net_profit', label: t('netProfit'), width: 150, align: 'right', render: (p) => formatMoney(p.net_profit, locale) },
    {
      key: 'latest_run_no',
      label: t('latestRun'),
      width: 150,
      render: (p) =>
        p.latest_run_id ? (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <span>#{p.latest_run_no}</span>
            {p.latest_is_final && <Chip size="small" color="success" variant="outlined" label={t('final')} sx={{ height: 18, fontSize: 11 }} />}
            {p.latest_source === 'legacy_import' && <Chip size="small" variant="outlined" label={t('sources.legacy_import')} sx={{ height: 18, fontSize: 11 }} />}
          </Stack>
        ) : (
          '-'
        ),
    },
    { key: 'member_count', label: t('members'), width: 100, align: 'right' },
    { key: 'sum_total', label: t('totalDividend'), width: 160, align: 'right', render: (p) => (p.totals ? <strong>{formatMoney(p.totals.sum_total, locale)}</strong> : '-') },
    { key: 'note', label: t('note') },
  ];

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canMutate ? (
            <GlassButton startIcon={<AddIcon />} onClick={() => setOpen(true)}>
              {t('newPeriod')}
            </GlassButton>
          ) : undefined
        }
      />
      <QueryError error={periods.error} onRetry={() => periods.refetch()} />
      <GlassTable columns={columns} rows={periods.data ?? []} rowKey={(p) => p.id} loading={periods.isPending} emptyText={t('noPeriods')} onRowClick={(p) => router.push(`/dividends/${p.id}`)} />
      <CreatePeriodDialog
        open={open}
        periods={periods.data ?? []}
        onClose={() => setOpen(false)}
        onCreated={(id) => {
          setOpen(false);
          toast.success(t('periodCreated'));
          router.push(`/dividends/${id}`);
        }}
      />
    </Stack>
  );
}
