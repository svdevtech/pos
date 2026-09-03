'use client';

import AddIcon from '@mui/icons-material/Add';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
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
import { GlassButton, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { num } from '@/lib/api/hooks/common';
import { MEMBER_STATUSES, useMembers, type MemberListParams, type MemberView } from '@/lib/api/hooks/members';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDate, formatMoney } from '@/lib/format';
import { useDebounce } from '@/lib/useDebounce';

const STATUS_COLOR: Record<string, 'success' | 'default' | 'error' | 'warning'> = {
  active: 'success',
  inactive: 'default',
  suspended: 'error',
};

export default function MembersPage() {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const [status, setStatus] = useState('');
  const [hasShares, setHasShares] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const params = useMemo<MemberListParams>(
    () => ({ q: debouncedQ.trim(), status, has_shares: hasShares, page, page_size: pageSize }),
    [debouncedQ, status, hasShares, page, pageSize],
  );
  const members = useMembers(params);

  const columns = useMemo<GridColDef<MemberView>[]>(
    () => [
      { field: 'member_code', headerName: t('memberCode'), width: 120 },
      {
        field: 'name',
        headerName: t('name'),
        flex: 1,
        minWidth: 200,
        renderCell: ({ row }) => (
          <Stack sx={{ minWidth: 0, py: 0.5 }}>
            <Typography variant="body2" noWrap>
              {row.name}
            </Typography>
            {row.line_user_id && (
              <Chip size="small" color="success" variant="outlined" label={t('lineLinked')} sx={{ width: 'fit-content', height: 18, fontSize: 11 }} />
            )}
          </Stack>
        ),
      },
      { field: 'phone', headerName: t('phone'), width: 140 },
      {
        field: 'share_capital',
        headerName: t('shareCapital'),
        width: 140,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => formatMoney(v as string, locale),
      },
      {
        field: 'ar_balance',
        headerName: t('arBalance'),
        width: 140,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ value }) => (
          <Typography variant="body2" color={num(value as string) > 0 ? 'warning.main' : 'text.primary'}>
            {formatMoney(value as string, locale)}
          </Typography>
        ),
      },
      {
        field: 'ytd_purchases',
        headerName: t('ytdPurchases'),
        width: 140,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => formatMoney(v as string, locale),
      },
      { field: 'joined_at', headerName: t('joinDate'), width: 120, valueFormatter: (v) => (v ? formatDate(v as string, locale) : '-') },
      {
        field: 'status',
        headerName: tc('status'),
        width: 120,
        renderCell: ({ value }) => (
          <Chip size="small" color={STATUS_COLOR[value as string] ?? 'default'} label={t.has(`statuses.${value}`) ? t(`statuses.${value}`) : String(value)} />
        ),
      },
    ],
    [t, tc, locale],
  );

  const resetPage = () => setPage(1);

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('title')}
        subtitle={members.data ? t('count', { count: members.data.total }) : undefined}
        actions={
          canMutate ? (
            <GlassButton startIcon={<AddIcon />} component={Link} href="/members/new">
              {t('addMember')}
            </GlassButton>
          ) : undefined
        }
      />

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <GlassInput
          size="small"
          label={t('search')}
          placeholder={t('searchHint')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            resetPage();
          }}
          sx={{ minWidth: 260, flex: 1 }}
          fullWidth={false}
        />
        <GlassInput
          select
          size="small"
          label={tc('status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetPage();
          }}
          sx={{ minWidth: 150 }}
          fullWidth={false}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{tc('all')}</MenuItem>
          {MEMBER_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {t(`statuses.${s}`)}
            </MenuItem>
          ))}
        </GlassInput>
        <GlassInput
          select
          size="small"
          label={t('hasShares')}
          value={hasShares}
          onChange={(e) => {
            setHasShares(e.target.value as '' | 'true' | 'false');
            resetPage();
          }}
          sx={{ minWidth: 150 }}
          fullWidth={false}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{tc('all')}</MenuItem>
          <MenuItem value="true">{t('withShares')}</MenuItem>
          <MenuItem value="false">{t('withoutShares')}</MenuItem>
        </GlassInput>
      </Stack>

      <QueryError error={members.error} onRetry={() => members.refetch()} />
      <ServerDataGrid<MemberView>
        rows={members.data?.items ?? []}
        columns={columns}
        rowCount={members.data?.total ?? 0}
        loading={members.isPending || members.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noMembers')}
        getRowClassName={() => 'row-clickable'}
        onRowClick={({ row }) => router.push(`/members/${row.id}`)}
      />
    </Stack>
  );
}
