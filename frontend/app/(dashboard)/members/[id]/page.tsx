'use client';

import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AddIcon from '@mui/icons-material/Add';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import type { GridColDef } from '@mui/x-data-grid';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import StatTile from '@/components/StatTile';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import MemberForm, { toMemberPatch } from '@/components/members/MemberForm';
import ShareDialog from '@/components/members/ShareDialog';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { num } from '@/lib/api/hooks/common';
import { useMemberDividendHistory, type MemberStatementRow } from '@/lib/api/hooks/dividends';
import {
  MEMBER_STATUSES,
  useCreateLinkCode,
  useMember,
  useMemberPurchases,
  useMemberShares,
  useSetMemberStatus,
  useUnlinkLine,
  useUpdateMember,
  type MemberDetail,
  type MemberStatus,
  type MonthTotal,
  type SaleBrief,
  type ShareTx,
} from '@/lib/api/hooks/members';
import { MUTATING_ROLES, type Role } from '@/lib/auth/session';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';

type TabKey = 'profile' | 'shares' | 'purchases' | 'dividends' | 'line';

const SELLER_ROLES: readonly Role[] = ['platform_admin', 'store_owner', 'manager', 'cashier'];
const STATUS_COLOR: Record<string, 'success' | 'default' | 'error'> = { active: 'success', inactive: 'default', suspended: 'error' };

function SharesPanel({ member, canMutate }: { member: MemberDetail; canMutate: boolean }) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [open, setOpen] = useState(false);
  const params = useMemo(() => ({ page, page_size: pageSize }), [page, pageSize]);
  const shares = useMemberShares(member.id, params);

  const columns = useMemo<GridColDef<ShareTx>[]>(
    () => [
      { field: 'occurred_at', headerName: t('occurredAt'), width: 160, valueFormatter: (v) => formatDateTime(v as string, locale) },
      {
        field: 'type',
        headerName: t('txType'),
        width: 150,
        valueFormatter: (v) => (t.has(`txTypes.${v as string}`) ? t(`txTypes.${v as string}`) : (v as string)),
      },
      {
        field: 'amount',
        headerName: t('amount'),
        width: 140,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ value }) => {
          const n = num(value as string);
          return (
            <Typography variant="body2" fontWeight={600} color={n < 0 ? 'error.main' : 'success.main'}>
              {n > 0 ? '+' : ''}
              {formatMoney(n, locale)}
            </Typography>
          );
        },
      },
      {
        field: 'balance_after',
        headerName: t('balanceAfter'),
        width: 140,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => formatMoney(v as string, locale),
      },
      { field: 'note', headerName: tc('notes'), flex: 1, minWidth: 200, sortable: false },
    ],
    [t, tc, locale],
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Typography variant="h6">
          {t('shareBalance')}: {formatMoney(member.share_balance, locale)}
        </Typography>
        {canMutate && (
          <GlassButton startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            {t('shareTx')}
          </GlassButton>
        )}
      </Stack>
      <QueryError error={shares.error} onRetry={() => shares.refetch()} />
      <ServerDataGrid<ShareTx>
        rows={shares.data?.items ?? []}
        columns={columns}
        rowCount={shares.data?.total ?? 0}
        loading={shares.isPending || shares.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noShareTx')}
      />
      <ShareDialog
        open={open}
        memberId={member.id}
        balance={member.share_balance}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          toast.success(t('sharePosted'));
        }}
      />
    </Stack>
  );
}

function PurchasesPanel({ memberId }: { memberId: string }) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const currentYear = dayjs().year();
  const [year, setYear] = useState(currentYear);
  const purchases = useMemberPurchases(memberId, year);
  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => currentYear - i), [currentYear]);
  const monthName = (m: number) => new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-US', { month: 'long' }).format(new Date(2000, m - 1, 1));

  const months = useMemo<MonthTotal[]>(() => {
    const byMonth = new Map((purchases.data?.months ?? []).map((m) => [m.month, m]));
    return Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) ?? { month: i + 1, total: '0', bills: 0 });
  }, [purchases.data]);

  const monthCols: GlassColumn<MonthTotal>[] = [
    { key: 'month', label: t('month'), render: (m) => monthName(m.month) },
    { key: 'bills', label: t('bills'), width: 90, align: 'right' },
    { key: 'total', label: tc('total'), width: 140, align: 'right', render: (m) => formatMoney(m.total, locale) },
  ];
  const saleCols: GlassColumn<SaleBrief>[] = [
    { key: 'doc_no', label: t('docNo'), width: 140 },
    { key: 'sold_at', label: t('soldAt'), width: 160, render: (s) => formatDateTime(s.sold_at, locale) },
    { key: 'net', label: t('net'), width: 130, align: 'right', render: (s) => formatMoney(s.net, locale) },
    {
      key: 'ar_status',
      label: t('arStatus'),
      width: 130,
      render: (s) =>
        s.ar_status && s.ar_status !== 'none' ? (
          <Chip size="small" color={s.ar_status === 'paid' ? 'success' : 'warning'} label={t.has(`arStatuses.${s.ar_status}`) ? t(`arStatuses.${s.ar_status}`) : s.ar_status} />
        ) : (
          ''
        ),
    },
    { key: 'ar_balance', label: t('arBalance'), width: 130, align: 'right', render: (s) => (num(s.ar_balance) > 0 ? formatMoney(s.ar_balance, locale) : '') },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <GlassInput select size="small" label={t('year')} value={String(year)} onChange={(e) => setYear(Number(e.target.value))} sx={{ width: 140 }} fullWidth={false}>
          {years.map((y) => (
            <MenuItem key={y} value={String(y)}>
              {locale === 'th' ? y + 543 : y}
            </MenuItem>
          ))}
        </GlassInput>
        <Typography variant="h6">
          {tc('total')}: {formatMoney(purchases.data?.total, locale)} · {t('bills')}: {purchases.data?.bills ?? 0}
        </Typography>
      </Stack>
      <QueryError error={purchases.error} onRetry={() => purchases.refetch()} />
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <GlassTable columns={monthCols} rows={months} rowKey={(m) => String(m.month)} loading={purchases.isPending} maxHeight={600} />
        </Grid>
        <Grid item xs={12} md={7}>
          <GlassCard title={t('recentSales')} sx={{ p: 2 }}>
            <GlassTable columns={saleCols} rows={purchases.data?.recent ?? []} rowKey={(s) => s.id} loading={purchases.isPending} emptyText={t('noPurchases')} maxHeight={520} />
          </GlassCard>
        </Grid>
      </Grid>
    </Stack>
  );
}

function DividendsPanel({ memberId }: { memberId: string }) {
  const t = useTranslations('members');
  const td = useTranslations('dividends');
  const locale = resolveLocale(useLocale());
  const history = useMemberDividendHistory(memberId);
  const columns: GlassColumn<MemberStatementRow>[] = [
    { key: 'be_year', label: td('beYear'), width: 100 },
    { key: 'shares', label: td('shares'), width: 110, align: 'right', render: (r) => formatMoney(r.shares, locale).replace('฿ ', '') },
    { key: 'purchases', label: td('purchases'), width: 140, align: 'right', render: (r) => formatMoney(r.purchases, locale) },
    { key: 'share_dividend', label: td('shareDividend'), width: 140, align: 'right', render: (r) => formatMoney(r.share_dividend, locale) },
    { key: 'rebate', label: td('rebate'), width: 140, align: 'right', render: (r) => formatMoney(r.rebate, locale) },
    { key: 'total', label: td('totalDividend'), width: 140, align: 'right', render: (r) => <strong>{formatMoney(r.total, locale)}</strong> },
    { key: 'paid_total', label: td('paidTotal'), width: 140, align: 'right', render: (r) => formatMoney(r.paid_total, locale) },
    {
      key: 'status',
      label: td('status'),
      width: 120,
      render: (r) => <Chip size="small" label={td.has(`statuses.${r.status}`) ? td(`statuses.${r.status}`) : r.status} />,
    },
    {
      key: 'link',
      label: '',
      width: 60,
      render: (r) => (
        <GlassButton size="small" variant="text" component={Link} href={`/dividends/${r.period_id}`}>
          {t('view')}
        </GlassButton>
      ),
    },
  ];
  return (
    <Stack spacing={2}>
      <QueryError error={history.error} onRetry={() => history.refetch()} />
      <GlassTable columns={columns} rows={history.data ?? []} rowKey={(r) => r.id} loading={history.isPending} emptyText={t('noDividends')} />
    </Stack>
  );
}

function LinePanel({ member, canLink, canUnlink }: { member: MemberDetail; canLink: boolean; canUnlink: boolean }) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const createCode = useCreateLinkCode(member.id);
  const unlink = useUnlinkLine(member.id);
  const [confirm, setConfirm] = useState(false);
  const linked = Boolean(member.line_user_id);

  return (
    <Stack spacing={2} sx={{ maxWidth: 560 }}>
      <GlassCard title={t('lineTab')}>
        <Stack spacing={2}>
          {linked ? (
            <>
              <Alert severity="success">
                {t('lineLinked')}
                {member.line_display ? ` · ${member.line_display}` : ''}
              </Alert>
              {canUnlink && (
                <GlassButton variant="outlined" color="error" startIcon={<LinkOffIcon />} onClick={() => setConfirm(true)} sx={{ alignSelf: 'flex-start' }}>
                  {t('unlink')}
                </GlassButton>
              )}
            </>
          ) : (
            <>
              <Alert severity="info">{t('lineNotLinked')}</Alert>
              <Typography variant="body2" color="text.secondary">
                {t('linkCodeHint')}
              </Typography>
              {canLink && (
                <GlassButton
                  startIcon={<LinkIcon />}
                  loading={createCode.isPending}
                  onClick={() => createCode.mutate(undefined, { onError: (err) => toast.error(errorMessage(err)) })}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {t('createLinkCode')}
                </GlassButton>
              )}
              {createCode.data && (
                <GlassCard strong sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('linkCode')}
                  </Typography>
                  <Typography variant="h3" fontFamily="monospace" letterSpacing={6} fontWeight={700}>
                    {createCode.data.code}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('expiresAt')}: {formatDateTime(createCode.data.expires_at, locale)}
                  </Typography>
                </GlassCard>
              )}
            </>
          )}
        </Stack>
      </GlassCard>
      <ConfirmDialog
        open={confirm}
        title={t('unlink')}
        message={t('unlinkConfirm', { name: member.name })}
        color="error"
        loading={unlink.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          unlink.mutate(undefined, {
            onSuccess: () => {
              toast.success(t('unlinked'));
              setConfirm(false);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
        confirmText={tc('confirm')}
      />
    </Stack>
  );
}

export default function MemberDetailPage() {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const canSell = hasRole(...SELLER_ROLES);
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const member = useMember(id);
  const update = useUpdateMember(id);
  const setStatus = useSetMemberStatus(id);
  const [tab, setTab] = useState<TabKey>('profile');
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);

  const m = member.data;

  return (
    <Stack spacing={3}>
      <PageHeader
        title={m ? `${m.member_code} · ${m.name}` : t('editMember')}
        subtitle={m?.joined_at ? `${t('joinDate')} ${formatDate(m.joined_at, locale)}` : undefined}
        backHref="/members"
        loading={member.isPending}
        actions={
          m ? (
            <>
              <Chip
                color={STATUS_COLOR[m.status] ?? 'default'}
                label={t.has(`statuses.${m.status}`) ? t(`statuses.${m.status}`) : m.status}
                onClick={canMutate ? (e) => setStatusAnchor(e.currentTarget) : undefined}
                sx={{ height: 40, fontWeight: 600 }}
              />
              {canMutate && (
                <Menu anchorEl={statusAnchor} open={Boolean(statusAnchor)} onClose={() => setStatusAnchor(null)}>
                  {MEMBER_STATUSES.map((s) => (
                    <MenuItem
                      key={s}
                      selected={s === m.status}
                      disabled={s === m.status || setStatus.isPending}
                      onClick={() => {
                        setStatusAnchor(null);
                        setStatus.mutate(s as MemberStatus, {
                          onSuccess: () => toast.success(t('statusChanged')),
                          onError: (err) => toast.error(errorMessage(err)),
                        });
                      }}
                    >
                      {t(`statuses.${s}`)}
                    </MenuItem>
                  ))}
                </Menu>
              )}
              <GlassButton variant="outlined" startIcon={<AccountBalanceWalletIcon />} component={Link} href={`/ar/${m.id}`}>
                {t('arTab')}
              </GlassButton>
            </>
          ) : undefined
        }
      />
      <QueryError error={member.error} onRetry={() => member.refetch()} />
      {member.isPending && <Skeleton variant="rounded" height={320} />}

      {m && (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <StatTile label={t('shareBalance')} value={formatMoney(m.share_balance, locale)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <StatTile
                label={t('arBalance')}
                value={formatMoney(m.ar_balance, locale)}
                hint={t('arBills', { count: m.ar_bills })}
                color={num(m.ar_balance) > 0 ? 'warning.main' : undefined}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <StatTile label={t('ytdPurchases')} value={formatMoney(m.ytd_purchases, locale)} hint={t('bills') + `: ${m.ytd_bills}`} />
            </Grid>
          </Grid>

          <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
            <Tab value="profile" label={t('profile')} />
            <Tab value="shares" label={t('shareLedger')} />
            <Tab value="purchases" label={t('purchases')} />
            <Tab value="dividends" label={t('dividends')} />
            <Tab value="line" label="LINE" />
          </Tabs>

          {tab === 'profile' && (
            <Stack sx={{ maxWidth: 980 }}>
              <MemberForm
                mode="edit"
                member={m}
                readOnly={!canMutate}
                submitting={update.isPending}
                error={update.error}
                onSubmit={(values) => update.mutate(toMemberPatch(values), { onSuccess: () => toast.success(tc('saved')) })}
              />
            </Stack>
          )}
          {tab === 'shares' && <SharesPanel member={m} canMutate={canMutate} />}
          {tab === 'purchases' && <PurchasesPanel memberId={m.id} />}
          {tab === 'dividends' && <DividendsPanel memberId={m.id} />}
          {tab === 'line' && <LinePanel member={m} canLink={canSell} canUnlink={canMutate} />}
        </>
      )}
    </Stack>
  );
}
