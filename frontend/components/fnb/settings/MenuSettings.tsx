'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItemOption from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import RecipeLinesEditor from '@/components/fnb/settings/RecipeLinesEditor';
import { useMenuAll } from '@/components/fnb/settings/useMenuAll';
import { GlassButton, GlassDialog, GlassInput, GlassTable } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { fnbApi, fnbKeys, type Channel, type MenuCategory, type MenuItem, type RecipeLine } from '@/lib/fnb/api';
import { formatMoney } from '@/lib/format';
import { dec } from '@/lib/pos/types';

const CHANNELS: Channel[] = ['counter', 'dine_in', 'takeaway', 'delivery', 'self_order'];
const CHANNEL_KEY: Record<Channel, string> = { counter: 'counter', dine_in: 'dineIn', takeaway: 'takeaway', delivery: 'delivery', self_order: 'selfOrder' };

type ItemDraft = Omit<MenuItem, 'id' | 'recipe'> & { id?: string; yield_qty: string; lines: RecipeLine[] };

/** Categories and the dishes in them, each with its price, station, channels, options and recipe. */
export default function MenuSettings() {
  const t = useTranslations('fnb.cfg');
  const tf = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const qc = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const menu = useMenuAll();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: fnbKeys.menu });
    void qc.invalidateQueries({ queryKey: fnbKeys.menuAll });
  };

  const [catId, setCatId] = useState('');
  const [cat, setCat] = useState<Partial<MenuCategory> | null>(null);
  const [item, setItem] = useState<ItemDraft | null>(null);

  const cats = menu.data?.categories ?? [];
  const active = catId || cats[0]?.id || '';
  const items = (menu.data?.items ?? []).filter((i) => !active || i.category_id === active);
  const stations = menu.data?.stations ?? [];
  const groups = menu.data?.modifier_groups ?? [];
  const stationName = Object.fromEntries(stations.map((s) => [s.id, s.name]));
  // every ingredient the menu already names, so a recipe line can show a name for a bare id
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const it of menu.data?.items ?? []) for (const l of it.recipe?.lines ?? []) if (l.ingredient_name) out[l.ingredient_product_id] = l.ingredient_name;
    for (const g of menu.data?.modifier_groups ?? []) for (const m of g.modifiers) for (const l of m.lines ?? []) if (l.ingredient_name) out[l.ingredient_product_id] = l.ingredient_name;
    return out;
  }, [menu.data]);

  const saveCat = useMutation({
    mutationFn: (c: Partial<MenuCategory>) => fnbApi.saveCategory(c),
    onSuccess: () => {
      invalidate();
      toast.success(t('saved'));
      setCat(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveItem = useMutation({
    mutationFn: (d: ItemDraft) => {
      const { yield_qty, lines, ...rest } = d;
      return fnbApi.saveItem({ ...rest, price: String(dec(rest.price)), recipe: { yield_qty: yield_qty || '1', lines: lines.filter((l) => l.ingredient_product_id) } });
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('saved'));
      setItem(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const newItem = (): ItemDraft => ({ name: '', name_en: '', price: '0', category_id: active || null, station_id: stations[0]?.id ?? null, channels: [...CHANNELS], sort: items.length, is_active: true, modifier_group_ids: [], yield_qty: '1', lines: [] });
  const editItem = (m: MenuItem): ItemDraft => ({ ...m, yield_qty: String(m.recipe?.yield_qty ?? '1'), lines: (m.recipe?.lines ?? []).map((l) => ({ ...l, qty: String(l.qty), factor_to_stock: String(l.factor_to_stock), waste_pct: String(l.waste_pct) })) });

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        {cats.map((c) => (
          <Chip key={c.id} label={c.is_active ? c.name : `${c.name} (${t('inactive')})`} clickable color={c.id === active ? 'primary' : 'default'} variant={c.id === active ? 'filled' : 'outlined'} onClick={() => setCatId(c.id)} onDelete={c.id === active ? () => setCat(c) : undefined} deleteIcon={<EditIcon fontSize="small" />} sx={{ fontWeight: 600 }} data-testid={`cfg-cat-${c.id}`} />
        ))}
        <GlassButton size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setCat({ name: '', name_en: '', sort: cats.length, is_active: true })} data-testid="cfg-add-cat">
          {t('addCategory')}
        </GlassButton>
        <Box sx={{ flex: 1 }} />
        <GlassButton size="small" startIcon={<AddIcon />} onClick={() => setItem(newItem())} disabled={cats.length === 0} data-testid="cfg-add-item">
          {t('addItem')}
        </GlassButton>
      </Stack>

      <GlassTable
        columns={[
          { key: 'name', label: t('name'), render: (m: MenuItem) => (m.is_active ? m.name : <span style={{ opacity: 0.55 }}>{m.name}</span>) },
          { key: 'price', label: t('price'), align: 'right', render: (m: MenuItem) => formatMoney(dec(m.price), locale) },
          { key: 'station', label: t('station'), render: (m: MenuItem) => stationName[m.station_id ?? ''] ?? '—' },
          { key: 'channels', label: t('channels'), render: (m: MenuItem) => m.channels.map((c) => tf(CHANNEL_KEY[c])).join(' · ') },
          { key: 'groups', label: t('modifierGroups'), align: 'right', render: (m: MenuItem) => m.modifier_group_ids.length },
          { key: 'recipe', label: t('recipe'), align: 'right', render: (m: MenuItem) => m.recipe?.lines?.length ?? 0 },
          {
            key: 'edit',
            label: '',
            align: 'right',
            width: 48,
            render: (m: MenuItem) => (
              <IconButton size="small" onClick={() => setItem(editItem(m))} aria-label="edit" data-testid={`cfg-edit-item-${m.id}`}>
                <EditIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]}
        rows={items}
        rowKey={(m) => m.id}
        loading={menu.isPending}
        emptyText={t('noItems')}
        size="small"
      />

      {/* ---------------------------------------------------------------- category */}
      {cat && (
        <GlassDialog
          open
          onClose={() => setCat(null)}
          title={cat.id ? t('editCategory') : t('addCategory')}
          maxWidth="xs"
          actions={
            <>
              <GlassButton variant="text" onClick={() => setCat(null)}>
                {t('cancel')}
              </GlassButton>
              <GlassButton onClick={() => saveCat.mutate(cat)} loading={saveCat.isPending} disabled={!cat.name?.trim()} data-testid="cfg-save-cat">
                {t('save')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <GlassInput label={t('name')} value={cat.name ?? ''} onChange={(e) => setCat({ ...cat, name: e.target.value })} autoFocus data-testid="cfg-cat-name" />
            <GlassInput label={t('nameEn')} value={cat.name_en ?? ''} onChange={(e) => setCat({ ...cat, name_en: e.target.value })} />
            <GlassInput label={t('sort')} type="number" value={cat.sort ?? 0} onChange={(e) => setCat({ ...cat, sort: Number(e.target.value) })} />
            <FormControlLabel control={<Checkbox checked={cat.is_active ?? true} onChange={(_, on) => setCat({ ...cat, is_active: on })} />} label={t('active')} />
          </Stack>
        </GlassDialog>
      )}

      {/* ---------------------------------------------------------------- item */}
      {item && (
        <GlassDialog
          open
          onClose={() => setItem(null)}
          title={item.id ? t('editItem') : t('addItem')}
          maxWidth="md"
          actions={
            <>
              <GlassButton variant="text" onClick={() => setItem(null)}>
                {t('cancel')}
              </GlassButton>
              <GlassButton onClick={() => saveItem.mutate(item)} loading={saveItem.isPending} disabled={!item.name.trim()} data-testid="cfg-save-item">
                {t('save')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <GlassInput label={t('name')} value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} autoFocus fullWidth data-testid="cfg-item-name" />
              <GlassInput label={t('nameEn')} value={item.name_en ?? ''} onChange={(e) => setItem({ ...item, name_en: e.target.value })} fullWidth />
              <GlassInput label={t('price')} type="number" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} inputProps={{ step: 'any', min: 0 }} sx={{ minWidth: 140 }} data-testid="cfg-item-price" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <GlassInput select label={t('category')} value={item.category_id ?? ''} onChange={(e) => setItem({ ...item, category_id: e.target.value || null })} fullWidth>
                {cats.map((c) => (
                  <MenuItemOption key={c.id} value={c.id}>
                    {c.name}
                  </MenuItemOption>
                ))}
              </GlassInput>
              <GlassInput select label={t('station')} value={item.station_id ?? ''} onChange={(e) => setItem({ ...item, station_id: e.target.value || null })} fullWidth>
                <MenuItemOption value="">—</MenuItemOption>
                {stations.map((s) => (
                  <MenuItemOption key={s.id} value={s.id}>
                    {s.name}
                  </MenuItemOption>
                ))}
              </GlassInput>
              <GlassInput label={t('sort')} type="number" value={item.sort} onChange={(e) => setItem({ ...item, sort: Number(e.target.value) })} sx={{ minWidth: 100 }} />
              <FormControlLabel control={<Checkbox checked={item.is_active} onChange={(_, on) => setItem({ ...item, is_active: on })} />} label={t('active')} sx={{ whiteSpace: 'nowrap' }} />
            </Stack>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('channels')}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {CHANNELS.map((c) => {
                  const on = item.channels.includes(c);
                  return <Chip key={c} label={tf(CHANNEL_KEY[c])} clickable color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} onClick={() => setItem({ ...item, channels: on ? item.channels.filter((x) => x !== c) : [...item.channels, c] })} data-testid={`cfg-channel-${c}`} />;
                })}
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('modifierGroups')}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {groups.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t('noGroups')}
                  </Typography>
                )}
                {groups.map((g) => {
                  const on = item.modifier_group_ids.includes(g.id);
                  return <Chip key={g.id} label={g.name} clickable color={on ? 'secondary' : 'default'} variant={on ? 'filled' : 'outlined'} onClick={() => setItem({ ...item, modifier_group_ids: on ? item.modifier_group_ids.filter((x) => x !== g.id) : [...item.modifier_group_ids, g.id] })} />;
                })}
              </Stack>
            </Box>
            <Divider />
            <Stack direction="row" alignItems="center" spacing={2}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                {t('recipe')}
              </Typography>
              <GlassInput size="small" label={t('yieldQty')} type="number" value={item.yield_qty} onChange={(e) => setItem({ ...item, yield_qty: e.target.value })} inputProps={{ step: 'any', min: 0 }} sx={{ width: 140 }} title={t('yieldHint')} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t('recipeHint')}
            </Typography>
            <RecipeLinesEditor lines={item.lines} onChange={(lines) => setItem({ ...item, lines })} names={names} />
          </Stack>
        </GlassDialog>
      )}
    </Box>
  );
}
