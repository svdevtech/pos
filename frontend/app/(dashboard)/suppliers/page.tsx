'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useCreateSupplier, useSuppliers, useUpdateSupplier, type Supplier } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { useDebounce } from '@/lib/useDebounce';

interface Values {
  code: string;
  name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  tax_id: string;
  note: string;
  is_active: boolean;
}

const EMPTY: Values = { code: '', name: '', address: '', phone: '', fax: '', email: '', tax_id: '', note: '', is_active: true };

function SupplierDialog({ open, supplier, onClose, onSaved }: { open: boolean; supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('suppliers');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useApiErrorMessage();
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        code: z.string().trim(),
        name: z.string().trim().min(1, tv('required')),
        address: z.string(),
        phone: z.string().trim(),
        fax: z.string().trim(),
        email: z.string().trim().refine((s) => s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), tv('email')),
        tax_id: z.string().trim(),
        note: z.string(),
        is_active: z.boolean(),
      }),
    [tv],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset(
      supplier
        ? {
            code: supplier.code ?? '',
            name: supplier.name,
            address: supplier.address ?? '',
            phone: supplier.phone ?? '',
            fax: supplier.fax ?? '',
            email: supplier.email ?? '',
            tax_id: supplier.tax_id ?? '',
            note: supplier.note ?? '',
            is_active: supplier.is_active,
          }
        : EMPTY,
    );
  }, [open, supplier, reset]);

  const pending = create.isPending || update.isPending;
  const submit = (v: Values) => {
    const opts = { onSuccess: () => onSaved(), onError: (err: unknown) => setFormError(errorMessage(err)) };
    if (supplier) update.mutate({ id: supplier.id, ...v }, opts);
    else create.mutate(v, opts);
  };

  const field = (name: keyof Values, label: string, extra: Record<string, unknown> = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field: f }) => (
        <GlassInput {...f} value={f.value as string} label={label} error={Boolean(errors[name])} helperText={errors[name]?.message as string | undefined} {...extra} />
      )}
    />
  );

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={pending}
      title={supplier ? t('editSupplier') : t('addSupplier')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton form="supplier-form" type="submit" loading={pending}>
            {tc('save')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} component="form" id="supplier-form" onSubmit={handleSubmit(submit)} noValidate sx={{ pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {field('code', t('code'), { sx: { maxWidth: { sm: 160 } } })}
          {field('name', t('name'), { autoFocus: true })}
        </Stack>
        {field('address', t('address'), { multiline: true, minRows: 2 })}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {field('phone', t('phone'))}
          {field('fax', t('fax'))}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {field('email', t('email'), { type: 'email' })}
          {field('tax_id', t('taxId'))}
        </Stack>
        {field('note', tc('notes'), { multiline: true, minRows: 2 })}
        <Controller
          name="is_active"
          control={control}
          render={({ field: f }) => (
            <FormControlLabel control={<Switch checked={f.value} onChange={(e) => f.onChange(e.target.checked)} />} label={tc('active')} />
          )}
        />
      </Stack>
    </GlassDialog>
  );
}

export default function SuppliersPage() {
  const t = useTranslations('suppliers');
  const tc = useTranslations('common');
  const toast = useToast();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const suppliers = useSuppliers(debouncedQ.trim());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const columns: GlassColumn<Supplier>[] = [
    { key: 'code', label: t('code'), width: 110 },
    { key: 'name', label: t('name') },
    { key: 'phone', label: t('phone'), width: 140 },
    { key: 'email', label: t('email'), width: 200 },
    { key: 'tax_id', label: t('taxId'), width: 150 },
    {
      key: 'is_active',
      label: tc('status'),
      width: 110,
      render: (s) => <Chip size="small" color={s.is_active ? 'success' : 'default'} label={s.is_active ? tc('active') : tc('inactive')} />,
    },
    ...(canMutate
      ? [
          {
            key: 'actions',
            label: tc('actions'),
            align: 'right' as const,
            width: 80,
            render: (s: Supplier) => (
              <IconButton
                size="small"
                aria-label={tc('edit')}
                onClick={() => {
                  setEditing(s);
                  setOpen(true);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('title')}
        subtitle={suppliers.data ? t('count', { count: suppliers.data.length }) : undefined}
        actions={
          canMutate ? (
            <GlassButton
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              {t('addSupplier')}
            </GlassButton>
          ) : undefined
        }
      />
      <GlassInput size="small" label={tc('search')} value={q} onChange={(e) => setQ(e.target.value)} sx={{ maxWidth: 360 }} />
      <QueryError error={suppliers.error} onRetry={() => suppliers.refetch()} />
      <GlassTable columns={columns} rows={suppliers.data ?? []} rowKey={(s) => s.id} loading={suppliers.isPending} emptyText={t('noSuppliers')} />
      <SupplierDialog
        open={open}
        supplier={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          toast.success(tc('saved'));
        }}
      />
    </Stack>
  );
}
