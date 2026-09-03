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
import { useCategories, useCreateCategory, useUpdateCategory, type Category } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';

interface Values {
  name: string;
  name_en: string;
  sort_order: string;
  is_active: boolean;
}

const EMPTY: Values = { name: '', name_en: '', sort_order: '0', is_active: true };

function CategoryDialog({
  open,
  category,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useApiErrorMessage();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, tv('required')),
        name_en: z.string(),
        sort_order: z.string().refine((s) => s === '' || /^-?\d+$/.test(s), tv('integer')),
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
      category
        ? { name: category.name, name_en: category.name_en ?? '', sort_order: String(category.sort_order ?? 0), is_active: category.is_active }
        : EMPTY,
    );
  }, [open, category, reset]);

  const pending = create.isPending || update.isPending;

  const submit = (v: Values) => {
    const body = { name: v.name.trim(), name_en: v.name_en.trim(), sort_order: Number(v.sort_order || 0), is_active: v.is_active };
    const opts = { onSuccess: () => onSaved(), onError: (err: unknown) => setFormError(errorMessage(err)) };
    if (category) update.mutate({ id: category.id, ...body }, opts);
    else create.mutate(body, opts);
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={pending}
      maxWidth="xs"
      title={category ? t('editCategory') : t('addCategory')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton form="category-form" type="submit" loading={pending}>
            {tc('save')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} component="form" id="category-form" onSubmit={handleSubmit(submit)} noValidate sx={{ pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <GlassInput {...field} autoFocus label={t('categoryName')} error={Boolean(errors.name)} helperText={errors.name?.message} />
          )}
        />
        <Controller name="name_en" control={control} render={({ field }) => <GlassInput {...field} label={t('categoryNameEn')} />} />
        <Controller
          name="sort_order"
          control={control}
          render={({ field }) => (
            <GlassInput
              {...field}
              label={t('sortOrder')}
              inputProps={{ inputMode: 'numeric' }}
              error={Boolean(errors.sort_order)}
              helperText={errors.sort_order?.message}
            />
          )}
        />
        <Controller
          name="is_active"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
              label={tc('active')}
            />
          )}
        />
      </Stack>
    </GlassDialog>
  );
}

export default function CategoriesPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const toast = useToast();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const categories = useCategories();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const columns: GlassColumn<Category>[] = [
    { key: 'sort_order', label: t('sortOrder'), width: 90, align: 'right' },
    { key: 'name', label: t('categoryName') },
    { key: 'name_en', label: t('categoryNameEn') },
    {
      key: 'is_active',
      label: tc('status'),
      width: 120,
      render: (c) => <Chip size="small" color={c.is_active ? 'success' : 'default'} label={c.is_active ? tc('active') : tc('inactive')} />,
    },
    ...(canMutate
      ? [
          {
            key: 'actions',
            label: tc('actions'),
            align: 'right' as const,
            width: 80,
            render: (c: Category) => (
              <IconButton
                size="small"
                aria-label={tc('edit')}
                onClick={() => {
                  setEditing(c);
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
        title={t('categories')}
        backHref="/products"
        actions={
          canMutate ? (
            <GlassButton
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              {t('addCategory')}
            </GlassButton>
          ) : undefined
        }
      />
      <QueryError error={categories.error} onRetry={() => categories.refetch()} />
      <GlassTable
        columns={columns}
        rows={categories.data ?? []}
        rowKey={(c) => c.id}
        loading={categories.isPending}
        emptyText={t('noCategories')}
      />
      <CategoryDialog
        open={open}
        category={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          toast.success(tc('saved'));
        }}
      />
    </Stack>
  );
}
