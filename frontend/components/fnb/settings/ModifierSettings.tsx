'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import RecipeLinesEditor from '@/components/fnb/settings/RecipeLinesEditor';
import { useMenuAll } from '@/components/fnb/settings/useMenuAll';
import { GlassButton, GlassDialog, GlassInput, GlassTable } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { useApiErrorMessage } from '@/lib/api/errors';
import { fnbApi, fnbKeys, type ModifierGroup, type ModifierGroupInput, type ModifierInput } from '@/lib/fnb/api';

type Draft = ModifierGroupInput;

/** Option groups — size, hot/iced, sweetness, milk, extras — each option with its price and what it does to the recipe. */
export default function ModifierSettings() {
  const t = useTranslations('fnb.cfg');
  const toast = useToast();
  const qc = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const menu = useMenuAll();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openLines, setOpenLines] = useState<number | null>(null);

  const groups = menu.data?.modifier_groups ?? [];
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const it of menu.data?.items ?? []) for (const l of it.recipe?.lines ?? []) if (l.ingredient_name) out[l.ingredient_product_id] = l.ingredient_name;
    for (const g of menu.data?.modifier_groups ?? []) for (const m of g.modifiers) for (const l of m.lines ?? []) if (l.ingredient_name) out[l.ingredient_product_id] = l.ingredient_name;
    return out;
  }, [menu.data]);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      fnbApi.saveModifierGroup({
        ...d,
        modifiers: d.modifiers
          .filter((m) => m.name.trim())
          // an option added in this dialog has no id yet; an empty string is not a uuid the API will take
          .map((m, i) => ({ ...m, id: m.id || undefined, group_id: m.group_id || undefined, sort: i, price_delta: String(m.price_delta || 0), lines: (m.lines ?? []).filter((l) => l.ingredient_product_id) })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fnbKeys.menu });
      void qc.invalidateQueries({ queryKey: fnbKeys.menuAll });
      toast.success(t('saved'));
      setDraft(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const setMod = (i: number, patch: Partial<ModifierInput>) => draft && setDraft({ ...draft, modifiers: draft.modifiers.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const blank = (): ModifierInput => ({ name: '', price_delta: '0', is_default: false, sort: draft?.modifiers.length ?? 0, is_active: true, lines: [] });

  return (
    <Box>
      <Stack direction="row" sx={{ mb: 1.5 }}>
        <Box sx={{ flex: 1 }} />
        <GlassButton size="small" startIcon={<AddIcon />} onClick={() => setDraft({ name: '', name_en: '', min_select: 0, max_select: 1, sort: groups.length, is_active: true, modifiers: [] })} data-testid="cfg-add-group">
          {t('addGroup')}
        </GlassButton>
      </Stack>
      <GlassTable
        columns={[
          { key: 'name', label: t('name'), render: (g: ModifierGroup) => (g.is_active ? g.name : <span style={{ opacity: 0.55 }}>{g.name}</span>) },
          { key: 'rule', label: t('selectRule'), render: (g: ModifierGroup) => `${g.min_select} – ${g.max_select}` },
          { key: 'mods', label: t('modifiers'), render: (g: ModifierGroup) => g.modifiers.map((m) => (Number(m.price_delta) ? `${m.name} +${Number(m.price_delta)}` : m.name)).join(' · ') },
          {
            key: 'edit',
            label: '',
            align: 'right',
            width: 48,
            render: (g: ModifierGroup) => (
              <IconButton size="small" onClick={() => setDraft({ ...g, modifiers: g.modifiers.map((m) => ({ ...m, price_delta: String(m.price_delta), lines: (m.lines ?? []).map((l) => ({ ...l, qty: String(l.qty), factor_to_stock: String(l.factor_to_stock), waste_pct: String(l.waste_pct) })) })) })} aria-label="edit" data-testid={`cfg-edit-group-${g.id}`}>
                <EditIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]}
        rows={groups}
        rowKey={(g) => g.id}
        loading={menu.isPending}
        emptyText={t('noGroups')}
        size="small"
      />

      {draft && (
        <GlassDialog
          open
          onClose={() => setDraft(null)}
          title={draft.id ? t('editGroup') : t('addGroup')}
          maxWidth="md"
          actions={
            <>
              <GlassButton variant="text" onClick={() => setDraft(null)}>
                {t('cancel')}
              </GlassButton>
              <GlassButton onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!draft.name.trim()} data-testid="cfg-save-group">
                {t('save')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <GlassInput label={t('name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus fullWidth data-testid="cfg-group-name" />
              <GlassInput label={t('nameEn')} value={draft.name_en ?? ''} onChange={(e) => setDraft({ ...draft, name_en: e.target.value })} fullWidth />
              <GlassInput label={t('minSelect')} type="number" value={draft.min_select} onChange={(e) => setDraft({ ...draft, min_select: Number(e.target.value) })} sx={{ minWidth: 110 }} />
              <GlassInput label={t('maxSelect')} type="number" value={draft.max_select} onChange={(e) => setDraft({ ...draft, max_select: Number(e.target.value) })} sx={{ minWidth: 110 }} />
              <FormControlLabel control={<Checkbox checked={draft.is_active} onChange={(_, on) => setDraft({ ...draft, is_active: on })} />} label={t('active')} sx={{ whiteSpace: 'nowrap' }} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t('selectRuleHint')}
            </Typography>
            <Typography variant="subtitle2">{t('modifiers')}</Typography>
            {draft.modifiers.map((m, i) => (
              <Box key={i} sx={{ p: 1, borderRadius: 2, border: '1px solid', borderColor: 'divider' }} data-testid="cfg-modifier">
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <GlassInput size="small" label={t('name')} value={m.name} onChange={(e) => setMod(i, { name: e.target.value })} sx={{ flex: 1, minWidth: 160 }} data-testid="cfg-modifier-name" />
                  <GlassInput size="small" label={t('priceDelta')} type="number" value={m.price_delta} onChange={(e) => setMod(i, { price_delta: e.target.value })} inputProps={{ step: 'any' }} sx={{ width: 120 }} />
                  <FormControlLabel control={<Checkbox checked={m.is_default} onChange={(_, on) => setMod(i, { is_default: on })} />} label={t('isDefault')} />
                  <FormControlLabel control={<Checkbox checked={m.is_active} onChange={(_, on) => setMod(i, { is_active: on })} />} label={t('active')} />
                  <GlassButton size="small" variant="text" endIcon={<ExpandMoreIcon sx={{ transform: openLines === i ? 'rotate(180deg)' : 'none' }} />} onClick={() => setOpenLines(openLines === i ? null : i)}>
                    {t('modifierRecipe')} ({m.lines?.length ?? 0})
                  </GlassButton>
                </Stack>
                <Collapse in={openLines === i}>
                  <Box sx={{ pt: 1 }}>
                    <RecipeLinesEditor lines={m.lines ?? []} onChange={(lines) => setMod(i, { lines })} names={names} />
                  </Box>
                </Collapse>
              </Box>
            ))}
            <GlassButton size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDraft({ ...draft, modifiers: [...draft.modifiers, blank()] })} sx={{ alignSelf: 'flex-start' }} data-testid="cfg-add-modifier">
              {t('addModifier')}
            </GlassButton>
          </Stack>
        </GlassDialog>
      )}
    </Box>
  );
}
