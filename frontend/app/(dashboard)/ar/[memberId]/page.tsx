'use client';

import PaymentsIcon from '@mui/icons-material/Payments';
import PersonIcon from '@mui/icons-material/Person';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import StatTile from '@/components/StatTile';
import { useToast } from '@/components/Toast';
import ReceivePaymentDialog, { type PaymentTarget } from '@/components/ar/ReceivePaymentDialog';
import { GlassButton, GlassCard, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useMemberBills, type ARBill, type ARPayment } from '@/lib/api/hooks/ar';
import { useMember } from '@/lib/api/hooks/members';
import type { Role } from '@/lib/auth/session';
import { formatDateTime, formatMoney } from '@/lib/format';

const SELLER_ROLES: readonly Role[] = ['platform_admin', 'store_owner', 'manager', 'cashier'];

export default function ARMemberPage() {
  const t = useTranslations('ar');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const { hasRole } = useSession();
  const canReceive = hasRole(...SELLER_ROLES);
  const params = useParams<{ memberId: string }>();
  const memberId = params?.memberId ?? '';

  const member = useMember(memberId);
  const bills = useMemberBills(memberId);
  const [target, setTarget] = useState<PaymentTarget | null>(null);

  const m = member.data;
  const memberRef = m ? { id: m.id, member_code: m.member_code, name: m.name } : null;

  const billCols: GlassColumn<ARBill>[] = [
    { key: 'doc_no', label: t('docNo'), width: 140 },
    { key: 'sold_at', label: t('soldAt'), width: 160, render: (b) => formatDateTime(b.sold_at, locale) },
    { key: 'net', label: t('billTotal'), width: 130, align: 'right', render: (b) => formatMoney(b.net, locale) },
    { key: 'ar_paid', label: t('paid'), width: 130, align: 'right', render: (b) => formatMoney(b.ar_paid, locale) },
    { key: 'ar_balance', label: t('remaining'), width: 130, align: 'right', render: (b) => <strong>{formatMoney(b.ar_balance, locale)}</strong> },
    {
      key: 'ar_status',
      label: tc('status'),
      width: 110,
      render: (b) => (
        <Chip size="small" color={b.ar_status === 'partial' ? 'warning' : 'error'} label={t.has(`arStatuses.${b.ar_status}`) ? t(`arStatuses.${b.ar_status}`) : b.ar_status} />
      ),
    },
    ...(canReceive
      ? [
          {
            key: 'actions',
            label: '',
            width: 120,
            align: 'right' as const,
            render: (b: ARBill) => (
              <GlassButton size="small" variant="outlined" onClick={() => setTarget({ member: memberRef, bill: { id: b.id, doc_no: b.doc_no, ar_balance: b.ar_balance } })}>
                {t('pay')}
              </GlassButton>
            ),
          },
        ]
      : []),
  ];

  const payCols: GlassColumn<ARPayment>[] = [
    { key: 'paid_at', label: t('paymentDate'), width: 160, render: (p) => formatDateTime(p.paid_at, locale) },
    { key: 'doc_no', label: t('docNo'), width: 140 },
    { key: 'sale_doc_no', label: t('bill'), width: 140, render: (p) => p.sale_doc_no || p.legacy_bill_no || '-' },
    { key: 'amount', label: t('amount'), width: 130, align: 'right', render: (p) => <strong>{formatMoney(p.amount, locale)}</strong> },
    { key: 'balance_after', label: t('balanceAfter'), width: 130, align: 'right', render: (p) => formatMoney(p.balance_after, locale) },
    { key: 'method', label: t('method'), width: 110, render: (p) => (t.has(`methods.${p.method}`) ? t(`methods.${p.method}`) : p.method) },
    { key: 'received_by_name', label: t('receivedBy'), width: 140 },
    { key: 'note', label: tc('notes') },
  ];

  return (
    <Stack spacing={3}>
      <PageHeader
        title={m ? `${m.member_code} · ${m.name}` : t('title')}
        subtitle={m?.phone}
        backHref="/ar"
        loading={member.isPending}
        actions={
          <>
            <GlassButton variant="outlined" startIcon={<PersonIcon />} component={Link} href={`/members/${memberId}`}>
              {t('viewMember')}
            </GlassButton>
            {canReceive && memberRef && (
              <GlassButton startIcon={<PaymentsIcon />} onClick={() => setTarget({ member: memberRef })} disabled={!bills.data || bills.data.bills?.length === 0}>
                {t('receivePayment')}
              </GlassButton>
            )}
          </>
        }
      />
      <QueryError error={member.error ?? bills.error} onRetry={() => void Promise.all([member.refetch(), bills.refetch()])} />
      {bills.isPending && <Skeleton variant="rounded" height={240} />}

      {bills.data && (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <StatTile label={t('outstanding')} value={formatMoney(bills.data.balance, locale)} color="warning.main" />
            </Grid>
            <Grid item xs={12} sm={4}>
              <StatTile label={t('openBills')} value={bills.data.bills?.length ?? 0} />
            </Grid>
          </Grid>
          <GlassCard title={t('bills')} sx={{ p: 2 }}>
            <GlassTable columns={billCols} rows={bills.data.bills ?? []} rowKey={(b) => b.id} emptyText={t('noBills')} />
          </GlassCard>
          <GlassCard title={t('payments')} sx={{ p: 2 }}>
            <GlassTable columns={payCols} rows={bills.data.payments ?? []} rowKey={(p) => p.id} emptyText={t('noPayments')} />
          </GlassCard>
        </>
      )}

      <ReceivePaymentDialog
        open={Boolean(target)}
        member={target?.member}
        bill={target?.bill}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          toast.success(t('paymentReceived'));
        }}
      />
    </Stack>
  );
}
