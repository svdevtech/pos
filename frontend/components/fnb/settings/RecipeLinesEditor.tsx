'use client';

import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { GlassButton, GlassInput } from '@/components/glass';
import ProductSearchDialog from '@/components/pos/ProductSearchDialog';
import { useUnits } from '@/lib/api/hooks/products';
import type { RecipeLine } from '@/lib/fnb/api';

/**
 * The lines of a recipe — a dish's, or a modifier's ("oat milk" replaces the milk; "extra shot"
 * adds beans). Each line: an ingredient (a product), how much of it in the recipe's unit, how
 * that unit converts to the unit the product is stocked in, and the waste allowance.
 * Arithmetic: backend/internal/usecase/fnbuc/recipe.go.
 */
export default function RecipeLinesEditor({ lines, onChange, names }: { lines: RecipeLine[]; onChange: (lines: RecipeLine[]) => void; names: Record<string, string> }) {
  const t = useTranslations('fnb.cfg');
  const units = useUnits();
  const [picking, setPicking] = useState<{ index: number; field: 'ingredient' | 'replaces' } | null>(null);

  const set = (i: number, patch: Partial<RecipeLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const nameOf = (id?: string | null) => (id ? names[id] ?? id.slice(0, 8) : '');

  return (
    <Box>
      {lines.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('noLines')}
        </Typography>
      )}
      <Stack spacing={1}>
        {lines.map((l, i) => (
          <Box key={i} sx={{ p: 1, borderRadius: 2, border: '1px dashed', borderColor: 'divider' }} data-testid="recipe-line">
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <GlassButton size="small" variant="outlined" onClick={() => setPicking({ index: i, field: 'ingredient' })} sx={{ minWidth: 160, justifyContent: 'flex-start' }} data-testid="pick-ingredient">
                {l.ingredient_name || nameOf(l.ingredient_product_id) || t('pickIngredient')}
              </GlassButton>
              <GlassInput size="small" type="number" label={t('qty')} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} inputProps={{ step: 'any', min: 0 }} sx={{ width: 110 }} />
              <GlassInput size="small" select label={t('unit')} value={l.unit_id ?? ''} onChange={(e) => set(i, { unit_id: e.target.value || null, unit_name: units.data?.find((u) => u.id === e.target.value)?.name })} sx={{ width: 130 }}>
                <MenuItem value="">—</MenuItem>
                {(units.data ?? []).map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.name}
                  </MenuItem>
                ))}
              </GlassInput>
              <GlassInput size="small" type="number" label={t('factor')} value={l.factor_to_stock} onChange={(e) => set(i, { factor_to_stock: e.target.value })} inputProps={{ step: 'any', min: 0 }} sx={{ width: 120 }} title={t('factorHint')} />
              <GlassInput size="small" type="number" label={t('waste')} value={l.waste_pct} onChange={(e) => set(i, { waste_pct: e.target.value })} inputProps={{ step: 'any', min: 0 }} sx={{ width: 100 }} />
              <GlassInput size="small" select label={t('mode')} value={l.mode} onChange={(e) => set(i, { mode: e.target.value as RecipeLine['mode'], replaces_product_id: e.target.value === 'add' ? null : l.replaces_product_id })} sx={{ width: 110 }}>
                <MenuItem value="add">{t('modeAdd')}</MenuItem>
                <MenuItem value="replace">{t('modeReplace')}</MenuItem>
              </GlassInput>
              {l.mode === 'replace' && (
                <GlassButton size="small" variant="outlined" color="warning" onClick={() => setPicking({ index: i, field: 'replaces' })} data-testid="pick-replaces">
                  {t('replaces')}: {nameOf(l.replaces_product_id) || '…'}
                </GlassButton>
              )}
              <IconButton size="small" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="remove" data-testid="remove-line">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Box>
        ))}
      </Stack>
      <GlassButton size="small" variant="text" startIcon={<AddIcon />} onClick={() => onChange([...lines, { ingredient_product_id: '', qty: '1', factor_to_stock: '1', waste_pct: '0', mode: 'add' }])} sx={{ mt: 1 }} data-testid="add-line">
        {t('addLine')}
      </GlassButton>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {t('factorHint')}
      </Typography>
      {picking && (
        <ProductSearchDialog
          open
          onClose={() => setPicking(null)}
          onPick={(p) => {
            if (picking.field === 'ingredient') set(picking.index, { ingredient_product_id: p.id, ingredient_name: p.name });
            else set(picking.index, { replaces_product_id: p.id });
            names[p.id] = p.name;
            setPicking(null);
          }}
        />
      )}
    </Box>
  );
}
