'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassDialog, GlassInput } from '@/components/glass';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useCreateUnit, useUnits, useUpdateUnit, type Unit } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';

interface Draft {
  id?: string;
  name: string;
  name_en: string;
}

function UnitsContent() {
  const t = useTranslations('units');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();

  const units = useUnits();
  const create = useCreateUnit();
  const update = useUpdateUnit();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmOff, setConfirmOff] = useState<Unit | null>(null);

  const save = () => {
    if (!draft || !draft.name.trim()) return;
    const payload = { name: draft.name.trim(), name_en: draft.name_en.trim() };
    const done = {
      onSuccess: () => {
        toast.success(t('saved'));
        setDraft(null);
      },
      onError: (e: unknown) => toast.error(errorMessage(e)),
    };
    if (draft.id) update.mutate({ id: draft.id, ...payload }, done);
    else create.mutate(payload, done);
  };

  const setActive = (u: Unit, active: boolean) => {
    update.mutate(
      { id: u.id, is_active: active },
      {
        onSuccess: () => {
          toast.success(active ? t('restored', { name: u.name }) : t('switchedOff', { name: u.name }));
          setConfirmOff(null);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 820 }}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        backHref="/settings"
        actions={
          <GlassButton startIcon={<AddIcon />} onClick={() => setDraft({ name: '', name_en: '' })} data-testid="unit-add">
            {t('add')}
          </GlassButton>
        }
      />

      <GlassCard>
        {units.isPending && <Skeleton variant="rounded" height={220} />}
        {units.data && (
          <Table size="small" data-testid="unit-list">
            <TableHead>
              <TableRow>
                <TableCell>{t('name')}</TableCell>
                <TableCell>{t('nameEn')}</TableCell>
                <TableCell align="right">{t('products')}</TableCell>
                <TableCell align="center">{t('active')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {units.data.map((u) => (
                <TableRow key={u.id} hover sx={{ opacity: u.is_active ? 1 : 0.55 }}>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" fontWeight={600}>
                        {u.name}
                      </Typography>
                      {!u.is_active && <Chip size="small" label={t('inactive')} />}
                    </Stack>
                  </TableCell>
                  <TableCell>{u.name_en ?? '—'}</TableCell>
                  <TableCell align="right">{u.product_count}</TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={u.is_active}
                      onChange={(e) => (e.target.checked ? setActive(u, true) : setConfirmOff(u))}
                      inputProps={{ 'aria-label': t('active') } as React.InputHTMLAttributes<HTMLInputElement>}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={tc('edit')}>
                      <IconButton size="small" onClick={() => setDraft({ id: u.id, name: u.name, name_en: u.name_en ?? '' })}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {units.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      {t('empty')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      <GlassDialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('edit') : t('add')}
        actions={
          <>
            <GlassButton variant="outlined" onClick={() => setDraft(null)}>
              {tc('cancel')}
            </GlassButton>
            <GlassButton onClick={save} disabled={!draft?.name.trim()} loading={create.isPending || update.isPending} data-testid="unit-save">
              {tc('save')}
            </GlassButton>
          </>
        }
      >
        <Stack spacing={2}>
          <GlassInput
            label={t('name')}
            value={draft?.name ?? ''}
            onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
            autoFocus
            inputProps={{ 'data-testid': 'unit-name' }}
          />
          <GlassInput
            label={t('nameEn')}
            value={draft?.name_en ?? ''}
            onChange={(e) => setDraft((d) => (d ? { ...d, name_en: e.target.value } : d))}
          />
        </Stack>
      </GlassDialog>

      <GlassDialog
        open={Boolean(confirmOff)}
        onClose={() => setConfirmOff(null)}
        title={t('switchOffTitle')}
        actions={
          <>
            <GlassButton variant="outlined" onClick={() => setConfirmOff(null)}>
              {tc('cancel')}
            </GlassButton>
            <GlassButton color="error" onClick={() => confirmOff && setActive(confirmOff, false)} data-testid="unit-switch-off">
              {t('switchOff')}
            </GlassButton>
          </>
        }
      >
        <Stack spacing={1}>
          <Alert severity="info">{t('switchOffBody')}</Alert>
          {confirmOff && confirmOff.product_count > 0 && (
            <Alert severity="warning">{t('stillUsed', { count: confirmOff.product_count })}</Alert>
          )}
        </Stack>
      </GlassDialog>
    </Stack>
  );
}

export default function UnitsPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <UnitsContent />
    </RequireAuth>
  );
}
