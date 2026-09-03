'use client';

import AddIcon from '@mui/icons-material/Add';
import CategoryIcon from '@mui/icons-material/Category';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import DateRangeFilter, { monthRange, type DateRange } from '@/components/DateRangeFilter';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import StatTile from '@/components/StatTile';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { RECEIVE_METHODS, decStr, num, type PaymentMethod } from '@/lib/api/hooks/common';
import {
  useCreateExpense,
  useDeleteExpense,
  useExpenseTypes,
  useExpenses,
  useSaveExpenseType,
  useUpdateExpense,
  type Expense,
  type ExpenseParams,
  type ExpenseType,
} from '@/lib/api/hooks/expenses';
import { MUTATING_ROLES, type Role } from '@/lib/auth/session';
import { today } from '@/lib/dates';
import { formatDate, formatMoney } from '@/lib/format';

const SELLER_ROLES: readonly Role[] = ['platform_admin', 'store_owner', 'manager', 'cashier'];

function typeName(t: ExpenseType | undefined, locale: string): string {
  if (!t) return '';
  return locale === 'en' && t.name_en ? t.name_en : t.name;
}

// ---------------------------------------------------------------------------
// Expense dialog
// ---------------------------------------------------------------------------

function ExpenseDialog({ open, expense, onClose, onSaved }: { open: boolean; expense: Expense | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const errorMessage = useApiErrorMessage();
  const types = useExpenseTypes();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const [typeId, setTypeId] = useState('');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [paidFrom, setPaidFrom] = useState<PaymentMethod>('cash');
  const [fromDrawer, setFromDrawer] = useState(false);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setTypeId(expense?.type_id ?? '');
    setDate(expense ? expense.expensed_at.slice(0, 10) : today());
    setAmount(expense ? String(num(expense.amount)) : '');
    setPaidFrom((expense?.paid_from as PaymentMethod) ?? 'cash');
    setFromDrawer(Boolean(expense?.shift_id));
    setNote(expense?.note ?? '');
  }, [open, expense]);

  const pending = create.isPending || update.isPending;
  const valid = num(amount) > 0 && Boolean(date);

  const submit = () => {
    setFormError(null);
    const body = {
      type_id: typeId || null,
      expensed_at: date,
      amount: decStr(amount),
      note: note.trim(),
      paid_from: paidFrom,
      from_drawer: paidFrom === 'cash' && fromDrawer,
    };
    const opts = { onSuccess: () => onSaved(), onError: (err: unknown) => setFormError(errorMessage(err)) };
    if (expense) update.mutate({ id: expense.id, ...body }, opts);
    else create.mutate(body, opts);
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={pending}
      maxWidth="xs"
      title={expense ? t('editExpense') : t('addExpense')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton onClick={submit} loading={pending} disabled={!valid}>
            {tc('save')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <GlassInput select label={t('category')} value={typeId} onChange={(e) => setTypeId(e.target.value)} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
          <MenuItem value="">
            <em>{tc('none')}</em>
          </MenuItem>
          {(types.data ?? [])
            .filter((x) => x.is_active || x.id === typeId)
            .map((x) => (
              <MenuItem key={x.id} value={x.id}>
                {typeName(x, locale)}
              </MenuItem>
            ))}
        </GlassInput>
        <GlassInput type="date" label={t('date')} value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <MoneyField label={t('amount')} value={amount} onChange={setAmount} autoFocus error={amount !== '' && num(amount) <= 0} />
        <GlassInput select label={t('paidFrom')} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as PaymentMethod)}>
          {RECEIVE_METHODS.map((m) => (
            <MenuItem key={m} value={m}>
              {t(`methods.${m}`)}
            </MenuItem>
          ))}
        </GlassInput>
        {paidFrom === 'cash' && !expense && (
          <FormControlLabel
            control={<Switch checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} />}
            label={
              <Stack>
                <Typography variant="body2">{t('fromDrawer')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('fromDrawerHint')}
                </Typography>
              </Stack>
            }
          />
        )}
        <GlassInput label={t('description')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
      </Stack>
    </GlassDialog>
  );
}

// ---------------------------------------------------------------------------
// Types dialog
// ---------------------------------------------------------------------------

function TypesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const types = useExpenseTypes();
  const save = useSaveExpenseType();
  const [editing, setEditing] = useState<ExpenseType | null>(null);
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [isActive, setIsActive] = useState(true);

  const startEdit = (x: ExpenseType | null) => {
    setEditing(x);
    setName(x?.name ?? '');
    setNameEn(x?.name_en ?? '');
    setIsActive(x?.is_active ?? true);
  };

  useEffect(() => {
    if (open) startEdit(null);
  }, [open]);

  const submit = () => {
    if (!name.trim()) return;
    save.mutate(
      { id: editing?.id, name: name.trim(), name_en: nameEn.trim(), is_active: isActive },
      {
        onSuccess: () => {
          toast.success(tc('saved'));
          startEdit(null);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const columns: GlassColumn<ExpenseType>[] = [
    { key: 'name', label: t('typeName') },
    { key: 'name_en', label: t('typeNameEn') },
    {
      key: 'is_active',
      label: tc('status'),
      width: 100,
      render: (x) => <Chip size="small" color={x.is_active ? 'success' : 'default'} label={x.is_active ? tc('active') : tc('inactive')} />,
    },
    {
      key: 'actions',
      label: '',
      width: 60,
      align: 'right',
      render: (x) => (
        <IconButton size="small" aria-label={tc('edit')} onClick={() => startEdit(x)}>
          <EditIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={save.isPending}
      title={t('manageTypes')}
      actions={
        <GlassButton variant="outlined" onClick={onClose}>
          {tc('close')}
        </GlassButton>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <GlassInput
            size="small"
            label={t('typeName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          <GlassInput size="small" label={t('typeNameEn')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          <FormControlLabel control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />} label={tc('active')} sx={{ whiteSpace: 'nowrap' }} />
          <GlassButton size="small" onClick={submit} loading={save.isPending} disabled={!name.trim()} sx={{ whiteSpace: 'nowrap' }}>
            {editing ? tc('save') : tc('add')}
          </GlassButton>
          {editing && (
            <GlassButton size="small" variant="text" onClick={() => startEdit(null)}>
              {tc('cancel')}
            </GlassButton>
          )}
        </Stack>
        <QueryError error={types.error} onRetry={() => types.refetch()} />
        <GlassTable columns={columns} rows={types.data ?? []} rowKey={(x) => x.id} loading={types.isPending} emptyText={t('noTypes')} isSelected={(x) => x.id === editing?.id} maxHeight={360} />
        <Typography variant="caption" color="text.secondary">
          {t('typesHint')}
        </Typography>
      </Stack>
    </GlassDialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExpensesPage() {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const canCreate = hasRole(...SELLER_ROLES);

  const [range, setRange] = useState<DateRange>(monthRange());
  const [typeId, setTypeId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [dialog, setDialog] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null });
  const [typesOpen, setTypesOpen] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const params = useMemo<ExpenseParams>(
    () => ({ from: range.from || undefined, to: range.to || undefined, type_id: typeId || undefined, page, page_size: pageSize }),
    [range, typeId, page, pageSize],
  );
  const expenses = useExpenses(params);
  const types = useExpenseTypes();
  const remove = useDeleteExpense();

  const columns = useMemo<GridColDef<Expense>[]>(
    () => [
      { field: 'expensed_at', headerName: t('date'), width: 120, valueFormatter: (v) => formatDate(v as string, locale) },
      {
        field: 'type_name',
        headerName: t('category'),
        width: 180,
        valueGetter: (_v, row) => typeName(types.data?.find((x) => x.id === row.type_id), locale) || row.type_name || '',
      },
      { field: 'note', headerName: t('description'), flex: 1, minWidth: 220, sortable: false },
      {
        field: 'amount',
        headerName: t('amount'),
        width: 140,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ value }) => (
          <Typography variant="body2" fontWeight={600}>
            {formatMoney(value as string, locale)}
          </Typography>
        ),
      },
      {
        field: 'paid_from',
        headerName: t('paidFrom'),
        width: 120,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <span>{t.has(`methods.${row.paid_from}`) ? t(`methods.${row.paid_from}`) : row.paid_from}</span>
            {row.shift_id && <Chip size="small" label={t('drawer')} sx={{ height: 18, fontSize: 11 }} />}
          </Stack>
        ),
      },
      { field: 'created_by_name', headerName: t('createdBy'), width: 140 },
      ...(canMutate
        ? [
            {
              field: 'actions',
              headerName: tc('actions'),
              width: 100,
              sortable: false,
              align: 'right',
              headerAlign: 'right',
              renderCell: ({ row }) => (
                <Stack direction="row" spacing={0.5}>
                  <IconButton size="small" aria-label={tc('edit')} onClick={() => setDialog({ open: true, expense: row })}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label={tc('delete')} onClick={() => setDeleting(row)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ),
            } as GridColDef<Expense>,
          ]
        : []),
    ],
    [t, tc, locale, canMutate, types.data],
  );

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('title')}
        actions={
          <>
            {canMutate && (
              <GlassButton variant="outlined" startIcon={<CategoryIcon />} onClick={() => setTypesOpen(true)}>
                {t('manageTypes')}
              </GlassButton>
            )}
            {canCreate && (
              <GlassButton startIcon={<AddIcon />} onClick={() => setDialog({ open: true, expense: null })}>
                {t('addExpense')}
              </GlassButton>
            )}
          </>
        }
      />

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <GlassInput
          select
          size="small"
          label={t('category')}
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 200 }}
          fullWidth={false}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{tc('all')}</MenuItem>
          {(types.data ?? []).map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {typeName(x, locale)}
            </MenuItem>
          ))}
        </GlassInput>
        <DateRangeFilter
          value={range}
          onChange={(r) => {
            setRange(r);
            setPage(1);
          }}
        />
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <StatTile label={t('total')} value={formatMoney(expenses.data?.sum, locale)} loading={expenses.isPending} hint={expenses.data ? t('count', { count: expenses.data.total }) : undefined} />
        </Grid>
      </Grid>

      <QueryError error={expenses.error} onRetry={() => expenses.refetch()} />
      <ServerDataGrid<Expense>
        rows={expenses.data?.items ?? []}
        columns={columns}
        rowCount={expenses.data?.total ?? 0}
        loading={expenses.isPending || expenses.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noExpenses')}
      />

      <ExpenseDialog
        open={dialog.open}
        expense={dialog.expense}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={() => {
          setDialog((d) => ({ ...d, open: false }));
          toast.success(tc('saved'));
        }}
      />
      <TypesDialog open={typesOpen} onClose={() => setTypesOpen(false)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title={tc('delete')}
        message={deleting ? t('deleteConfirm', { amount: formatMoney(deleting.amount, locale), date: formatDate(deleting.expensed_at, locale) }) : ''}
        color="error"
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(tc('deleted'));
              setDeleting(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          });
        }}
      />
    </Stack>
  );
}
