'use client';

import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { formatMoney } from '@/lib/format';
import type { CartLine } from '@/lib/fnb/store';
import type { MenuItem, ModifierGroup } from '@/lib/fnb/types';

/** Size, sweetness, milk, extras: the questions asked once per item, answered by tapping chips. */
export default function ModifierDialog({
  item,
  groups: groupById,
  price,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  groups: Record<string, ModifierGroup>;
  price: (l: CartLine) => number;
  onClose: () => void;
  onAdd: (l: CartLine) => void;
}) {
  const t = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const groups = item.modifierGroupIds.map((id) => groupById[id]).filter(Boolean);
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, g.modifiers.filter((m) => m.isDefault).map((m) => m.id)])),
  );
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const toggle = (gid: string, mid: string) => {
    const g = groupById[gid];
    setChosen((c) => {
      const cur = c[gid] ?? [];
      if (cur.includes(mid)) return { ...c, [gid]: cur.filter((x) => x !== mid) };
      if (g.maxSelect === 1) return { ...c, [gid]: [mid] };
      if (cur.length >= g.maxSelect) return c;
      return { ...c, [gid]: [...cur, mid] };
    });
  };

  const modifierIds = Object.values(chosen).flat();
  const valid = groups.every((g) => (chosen[g.id]?.length ?? 0) >= g.minSelect);
  const unit = price({ menuItemId: item.id, qty: 1, modifierIds });

  return (
    <GlassDialog
      open
      onClose={onClose}
      title={`${item.emoji} ${item.name}`}
      maxWidth="sm"
      data-testid="modifier-dialog"
      actions={
        <>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mr: 'auto' }}>
            <IconButton onClick={() => setQty((q) => Math.max(1, q - 1))}>
              <RemoveIcon />
            </IconButton>
            <Typography variant="h6" fontWeight={800} sx={{ minWidth: 28, textAlign: 'center' }} data-testid="dialog-qty">
              {qty}
            </Typography>
            <IconButton onClick={() => setQty((q) => q + 1)}>
              <AddIcon />
            </IconButton>
          </Stack>
          <GlassButton size="large" disabled={!valid} onClick={() => onAdd({ menuItemId: item.id, qty, modifierIds, note: note.trim() || undefined })} data-testid="dialog-add">
            {t('add')} · {formatMoney(unit * qty, locale)}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2.5}>
        {groups.map((g) => (
          <Box key={g.id}>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
              <Typography fontWeight={700}>{g.name}</Typography>
              <Typography variant="caption" color={g.minSelect > 0 ? 'error.main' : 'text.secondary'}>
                {g.minSelect > 0 ? t('required') : t('chooseUpTo', { n: g.maxSelect })}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {g.modifiers.map((m) => {
                const on = chosen[g.id]?.includes(m.id);
                return (
                  <Chip
                    key={m.id}
                    label={m.priceDelta ? `${m.name} +${m.priceDelta}` : m.name}
                    clickable
                    color={on ? 'primary' : 'default'}
                    variant={on ? 'filled' : 'outlined'}
                    onClick={() => toggle(g.id, m.id)}
                    sx={{ fontSize: 15, py: 2.4, fontWeight: on ? 700 : 500 }}
                    data-testid={`mod-${m.id}`}
                  />
                );
              })}
            </Stack>
          </Box>
        ))}
        <GlassInput label={t('note')} placeholder={t('notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} size="small" />
        {item.recipe && (
          <Box sx={{ borderRadius: 2, p: 1.5, background: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)') }}>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              {t('recipe')} · {t('perServing')}
            </Typography>
            <Typography variant="body2">{item.recipe.map((r) => `${r.ingredient} ${r.qty} ${r.unit}`).join(' · ')}</Typography>
          </Box>
        )}
      </Stack>
    </GlassDialog>
  );
}
