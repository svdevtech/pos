'use client';

import PaymentsIcon from '@mui/icons-material/Payments';
import TimelineIcon from '@mui/icons-material/Timeline';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import { useToast } from '@/components/Toast';
import ReceivePaymentDialog, { type PaymentTarget } from '@/components/ar/ReceivePaymentDialog';
import { GlassButton, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useARAccounts, type ARAccount, type ARAccountsParams } from '@/lib/api/hooks/ar';
import type { Role } from '@/lib/auth/session';
import { formatDate, formatMoney } from '@/lib/format';
import { useDebounce } from '@/lib/useDebounce';

const SELLER_ROLES: readonly Role[] = ['platform_admin', 'store_owner', 'manager', 'cashier'];

export default function ARPage() {
  const t = useTranslations('ar');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const toast = useToast();
  const { hasRole } = useSession();
  const canReceive = hasRole(...SELLER_ROLES);

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [target, setTarget] = useState<PaymentTarget | null>(null);

  const params = useMemo<ARAccountsParams>(() => ({ q: debouncedQ.trim(), page, page_size: pageSize }), [debouncedQ, page, pageSize]);
  const accounts = useARAccounts(params);

  const columns = useMemo<GridColDef<ARAccount>[]>(
    () => [
      { field: 'member_code', headerName: t('memberCode'), width: 120 },
      { field: 'member_name', headerName: t('member'), flex: 1, minWidth: 200 },
      { field: 'phone', headerName: t('phone'), width: 140 },
      { field: 'open_bills', headerName: t('openBills'), width: 110, align: 'right', headerAlign: 'right' },
      {
        field: 'balance',
        headerName: t('balance'),
        width: 150,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ value }) => (
          <Typography variant="body2" fontWeight={700} color="warning.main">
            {formatMoney(value as string, locale)}
          </Typography>
        ),
      },
      { field: 'oldest_due', headerName: t('oldestDue'), width: 130, valueFormatter: (v) => (v ? formatDate(v as string, locale) : '-') },
      { field: 'last_paid_at', headerName: t('lastPaid'), width: 130, valueFormatter: (v) => (v ? formatDate(v as string, locale) : '-') },
      ...(canReceive
        ? [
            {
              field: 'actions',
              headerName: '',
              width: 70,
              sortable: false,
              align: 'right',
              renderCell: ({ row }) => (
                <Tooltip title={t('receivePayment')}>
                  <IconButton
                    size="small"
                    aria-label={t('receivePayment')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTarget({ member: { id: row.member_id, member_code: row.member_code, name: row.member_name } });
                    }}
                  >
                    <PaymentsIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ),
            } as GridColDef<ARAccount>,
          ]
        : []),
    ],
    [t, locale, canReceive],
  );

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('title')}
        subtitle={accounts.data ? t('accountsCount', { count: accounts.data.total }) : undefined}
        actions={
          <>
            <GlassButton variant="outlined" startIcon={<TimelineIcon />} component={Link} href="/ar/aging">
              {t('aging')}
            </GlassButton>
            {canReceive && (
              <GlassButton startIcon={<PaymentsIcon />} onClick={() => setTarget({})}>
                {t('receivePayment')}
              </GlassButton>
            )}
          </>
        }
      />
      <GlassInput
        size="small"
        label={t('search')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        sx={{ maxWidth: 360 }}
      />
      <QueryError error={accounts.error} onRetry={() => accounts.refetch()} />
      <ServerDataGrid<ARAccount>
        rows={accounts.data?.items ?? []}
        columns={columns}
        rowCount={accounts.data?.total ?? 0}
        loading={accounts.isPending || accounts.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noAccounts')}
        getRowId={(r) => r.member_id}
        getRowClassName={() => 'row-clickable'}
        onRowClick={({ row }) => router.push(`/ar/${row.member_id}`)}
      />
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
