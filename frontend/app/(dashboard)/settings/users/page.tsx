'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useSession } from '@/components/Providers';
import RequireAuth from '@/components/RequireAuth';
import { GlassButton, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { locales, resolveLocale, type Locale } from '@/i18n/config';
import { api, isApiError, unwrapList, type Page } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { MUTATING_ROLES, type Role } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';

interface StoreUser {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  locale: Locale;
  is_active: boolean;
  must_reset_password?: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

interface FormValues {
  username: string;
  display_name: string;
  role: Role;
  locale: Locale;
  is_active: boolean;
  password: string;
}

const STORE_ROLES: readonly Role[] = ['store_owner', 'manager', 'cashier', 'viewer'];
const MIN_PASSWORD = 8;
const USERS_KEY = ['store-users'] as const;

function UserDialog({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: StoreUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const isEdit = Boolean(user);

  const schema = useMemo(
    () =>
      z.object({
        username: z.string().trim().min(1, tv('required')),
        display_name: z.string().trim().min(1, tv('required')),
        role: z.enum(STORE_ROLES as unknown as [Role, ...Role[]]),
        locale: z.enum(locales),
        is_active: z.boolean(),
        password: isEdit
          ? z.string().refine((v) => v === '' || v.length >= MIN_PASSWORD, tv('minLength', { min: MIN_PASSWORD }))
          : z.string().min(MIN_PASSWORD, tv('minLength', { min: MIN_PASSWORD })),
      }),
    [tv, isEdit],
  );

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', display_name: '', role: 'cashier', locale: 'th', is_active: true, password: '' },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset(
      user
        ? {
            username: user.username,
            display_name: user.display_name,
            role: user.role,
            locale: user.locale,
            is_active: user.is_active,
            password: '',
          }
        : { username: '', display_name: '', role: 'cashier', locale: 'th', is_active: true, password: '' },
    );
  }, [open, user, reset]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (user) {
        const body: Partial<FormValues> = {
          display_name: values.display_name,
          role: values.role,
          locale: values.locale,
          is_active: values.is_active,
        };
        if (values.password) body.password = values.password;
        return api.patch<StoreUser>(`/store/users/${user.id}`, body);
      }
      return api.post<StoreUser>('/store/users', values);
    },
    onSuccess: () => onSaved(),
    onError: (err) => {
      if (isApiError(err) && err.hasFields) {
        let matched = false;
        for (const [field, msg] of Object.entries(err.fields)) {
          if (field in ({} as FormValues) || ['username', 'display_name', 'role', 'locale', 'password'].includes(field)) {
            matched = true;
            setError(field as keyof FormValues, { type: 'server', message: tv.has(msg) ? tv(msg) : msg });
          }
        }
        if (!matched) setFormError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    },
  });

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title={isEdit ? t('editUser') : t('addUser')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={mutation.isPending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton form="user-form" type="submit" loading={mutation.isPending}>
            {tc('save')}
          </GlassButton>
        </>
      }
    >
      <Stack
        spacing={2}
        component="form"
        id="user-form"
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        noValidate
        sx={{ pt: 1 }}
      >
        {formError && <Alert severity="error">{formError}</Alert>}
        <Controller
          name="username"
          control={control}
          render={({ field }) => (
            <GlassInput
              {...field}
              label={t('username')}
              disabled={isEdit}
              autoComplete="off"
              error={Boolean(errors.username)}
              helperText={errors.username?.message}
            />
          )}
        />
        <Controller
          name="display_name"
          control={control}
          render={({ field }) => (
            <GlassInput
              {...field}
              label={t('displayName')}
              error={Boolean(errors.display_name)}
              helperText={errors.display_name?.message}
            />
          )}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <GlassInput {...field} select label={t('role')} error={Boolean(errors.role)} helperText={errors.role?.message}>
                {STORE_ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {t(`roles.${r}`)}
                  </MenuItem>
                ))}
              </GlassInput>
            )}
          />
          <Controller
            name="locale"
            control={control}
            render={({ field }) => (
              <GlassInput {...field} select label={t('locale')}>
                {locales.map((l) => (
                  <MenuItem key={l} value={l}>
                    {l === 'th' ? tc('thai') : tc('english')}
                  </MenuItem>
                ))}
              </GlassInput>
            )}
          />
        </Stack>
        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <GlassInput
              {...field}
              type="password"
              label={t('userPassword')}
              autoComplete="new-password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message ?? (isEdit ? t('leaveBlank') : t('passwordHint'))}
            />
          )}
        />
        <Controller
          name="is_active"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
              label={t('isActive')}
            />
          )}
        />
      </Stack>
    </GlassDialog>
  );
}

function UsersContent() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const { hasRole } = useSession();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const canMutate = hasRole(...MUTATING_ROLES);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StoreUser | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: async () => unwrapList(await api.get<StoreUser[] | Page<StoreUser>>('/store/users')),
  });

  const columns: GlassColumn<StoreUser>[] = [
    { key: 'username', label: t('username') },
    { key: 'display_name', label: t('displayName') },
    { key: 'role', label: t('role'), render: (u) => t(`roles.${u.role}`) },
    { key: 'locale', label: t('locale'), render: (u) => u.locale.toUpperCase() },
    {
      key: 'is_active',
      label: tc('status'),
      render: (u) => (
        <Chip size="small" color={u.is_active ? 'success' : 'default'} label={u.is_active ? tc('active') : tc('inactive')} />
      ),
    },
    { key: 'last_login_at', label: t('lastLogin'), render: (u) => formatDateTime(u.last_login_at, locale) },
    ...(canMutate
      ? [
          {
            key: 'actions',
            label: tc('actions'),
            align: 'right' as const,
            width: 80,
            render: (u: StoreUser) => (
              <IconButton
                size="small"
                aria-label={tc('edit')}
                onClick={() => {
                  setEditing(u);
                  setDialogOpen(true);
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
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Typography variant="h4" component="h1" fontWeight={700}>
          {t('users')}
        </Typography>
        {canMutate && (
          <GlassButton
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            {t('addUser')}
          </GlassButton>
        )}
      </Stack>

      {users.isError && (
        <Alert
          severity="error"
          action={
            <GlassButton size="small" variant="text" onClick={() => users.refetch()}>
              {tc('retry')}
            </GlassButton>
          }
        >
          {errorMessage(users.error)}
        </Alert>
      )}

      <GlassTable
        columns={columns}
        rows={users.data ?? []}
        rowKey={(u) => u.id}
        loading={users.isPending}
        emptyText={t('noUsers')}
      />

      <UserDialog
        open={dialogOpen}
        user={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          setDialogOpen(false);
          setToast(t('userSaved'));
          void queryClient.invalidateQueries({ queryKey: USERS_KEY });
        }}
      />

      <Snackbar open={Boolean(toast)} autoHideDuration={3000} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}

export default function UsersPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <UsersContent />
    </RequireAuth>
  );
}
