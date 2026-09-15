'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItemOption from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMenuAll } from '@/components/fnb/settings/useMenuAll';
import { GlassButton, GlassDialog, GlassInput, GlassTable } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { useApiErrorMessage } from '@/lib/api/errors';
import { fnbApi, fnbKeys, type MenuPromo } from '@/lib/fnb/api';

type Draft = Omit<MenuPromo, 'id'> & { id?: string };
const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Happy hour, a weekday lunch price, a launch offer: a price rule on a dish or a category by day and time. */
export default function PromoSettings() {
  const t = useTranslations('fnb.cfg');
  const td = useTranslations('fnb.days');
  const toast = useToast();
  const qc = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const menu = useMenuAll();
  const promos = useQuery({ queryKey: fnbKeys.promos, queryFn: () => fnbApi.promos(true), staleTime: 30_000 });
  const [draft, setDraft] = useState<Draft | null>(null);

  const cats = menu.data?.categories ?? [];
  const items = menu.data?.items ?? [];
  const nameOf = (p: MenuPromo) => (p.menu_item_id ? items.find((i) => i.id === p.menu_item_id)?.name : cats.find((c) => c.id === p.category_id)?.name) ?? '—';
  const kindLabel = (p: MenuPromo) => (p.kind === 'percent' ? `-${Number(p.value)}%` : p.kind === 'amount' ? `-฿${Number(p.value)}` : `฿${Number(p.value)}`);

  const save = useMutation({
    mutationFn: (d: Draft) => fnbApi.savePromo({ ...d, value: String(d.value || 0) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fnbKeys.promos });
      void qc.invalidateQueries({ queryKey: fnbKeys.menu });
      void qc.invalidateQueries({ queryKey: fnbKeys.menuAll });
      toast.success(t('saved'));
      setDraft(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const scope = draft?.menu_item_id ? 'item' : 'category';
  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }} spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t('promosHint')}
        </Typography>
        <GlassButton size="small" startIcon={<AddIcon />} onClick={() => setDraft({ name: '', kind: 'percent', value: '10', category_id: cats[0]?.id ?? null, menu_item_id: null, days: [...DAYS], start_time: '14:00', end_time: '17:00', is_active: true, sort: (promos.data?.length ?? 0) })} disabled={cats.length === 0} data-testid="cfg-add-promo">
          {t('addPromo')}
        </GlassButton>
      </Stack>
      <GlassTable
        columns={[
          { key: 'name', label: t('name'), render: (p: MenuPromo) => (p.is_active ? p.name : <span style={{ opacity: 0.55 }}>{p.name}</span>) },
          { key: 'scope', label: t('promoScope'), render: (p: MenuPromo) => nameOf(p) },
          { key: 'kind', label: t('promoValue'), align: 'right', render: (p: MenuPromo) => kindLabel(p) },
          { key: 'when', label: t('promoWhen'), render: (p: MenuPromo) => `${p.days.length === 7 ? t('everyDay') : p.days.map((d) => td(String(d))).join(' ')} · ${p.start_time}–${p.end_time}${p.starts_on || p.ends_on ? ` · ${p.starts_on?.slice(0, 10) ?? '…'} → ${p.ends_on?.slice(0, 10) ?? '…'}` : ''}` },
          {
            key: 'edit',
            label: '',
            align: 'right',
            width: 48,
            render: (p: MenuPromo) => (
              <IconButton size="small" onClick={() => setDraft({ ...p, value: String(p.value), starts_on: p.starts_on?.slice(0, 10) ?? null, ends_on: p.ends_on?.slice(0, 10) ?? null })} aria-label="edit" data-testid={`cfg-edit-promo-${p.id}`}>
                <EditIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]}
        rows={promos.data ?? []}
        rowKey={(p) => p.id}
        loading={promos.isPending}
        emptyText={t('noPromos')}
        size="small"
      />
      {draft && (
        <GlassDialog
          open
          onClose={() => setDraft(null)}
          title={draft.id ? t('editPromo') : t('addPromo')}
          maxWidth="sm"
          actions={
            <>
              <GlassButton variant="text" onClick={() => setDraft(null)}>
                {t('cancel')}
              </GlassButton>
              <GlassButton onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!draft.name.trim()} data-testid="cfg-save-promo">
                {t('save')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <GlassInput label={t('name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus data-testid="cfg-promo-name" />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <GlassInput select label={t('promoScope')} value={scope} onChange={(e) => setDraft(e.target.value === 'item' ? { ...draft, category_id: null, menu_item_id: items[0]?.id ?? null } : { ...draft, menu_item_id: null, category_id: cats[0]?.id ?? null })} sx={{ minWidth: 150 }}>
                <MenuItemOption value="category">{t('category')}</MenuItemOption>
                <MenuItemOption value="item">{t('promoItem')}</MenuItemOption>
              </GlassInput>
              {scope === 'item' ? (
                <GlassInput select label={t('promoItem')} value={draft.menu_item_id ?? ''} onChange={(e) => setDraft({ ...draft, menu_item_id: e.target.value })} fullWidth>
                  {items.map((i) => (
                    <MenuItemOption key={i.id} value={i.id}>
                      {i.name}
                    </MenuItemOption>
                  ))}
                </GlassInput>
              ) : (
                <GlassInput select label={t('category')} value={draft.category_id ?? ''} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })} fullWidth>
                  {cats.map((c) => (
                    <MenuItemOption key={c.id} value={c.id}>
                      {c.name}
                    </MenuItemOption>
                  ))}
                </GlassInput>
              )}
            </Stack>
            <Stack direction="row" spacing={2}>
              <GlassInput select label={t('promoKind')} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MenuPromo['kind'] })} sx={{ minWidth: 180 }}>
                <MenuItemOption value="percent">{t('promoPercent')}</MenuItemOption>
                <MenuItemOption value="amount">{t('promoAmount')}</MenuItemOption>
                <MenuItemOption value="price">{t('promoFixed')}</MenuItemOption>
              </GlassInput>
              <GlassInput label={t('promoValue')} type="number" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputProps={{ step: 'any', min: 0 }} sx={{ width: 140 }} data-testid="cfg-promo-value" />
            </Stack>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('promoDays')}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {DAYS.map((d) => {
                  const on = draft.days.includes(d);
                  return <Chip key={d} label={td(String(d))} clickable color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} onClick={() => setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort() })} />;
                })}
              </Stack>
            </Box>
            <Stack direction="row" spacing={2}>
              <GlassInput label={t('promoFrom')} type="time" value={draft.start_time} onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 150 }} />
              <GlassInput label={t('promoTo')} type="time" value={draft.end_time} onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 150 }} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <GlassInput label={t('promoStartsOn')} type="date" value={draft.starts_on ?? ''} onChange={(e) => setDraft({ ...draft, starts_on: e.target.value || null })} InputLabelProps={{ shrink: true }} sx={{ width: 180 }} />
              <GlassInput label={t('promoEndsOn')} type="date" value={draft.ends_on ?? ''} onChange={(e) => setDraft({ ...draft, ends_on: e.target.value || null })} InputLabelProps={{ shrink: true }} sx={{ width: 180 }} />
              <FormControlLabel control={<Checkbox checked={draft.is_active} onChange={(_, on) => setDraft({ ...draft, is_active: on })} />} label={t('active')} />
            </Stack>
          </Stack>
        </GlassDialog>
      )}
    </Box>
  );
}
