'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItemOption from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMenuAll } from '@/components/fnb/settings/useMenuAll';
import { GlassButton, GlassDialog, GlassInput, GlassTable } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { useApiErrorMessage } from '@/lib/api/errors';
import { fnbApi, fnbKeys, type Station } from '@/lib/fnb/api';

type Draft = Omit<Station, 'id'> & { id?: string };

/** Kitchen stations: the bar, the hot kitchen, desserts — each on a screen, a printer, or both. */
export default function StationSettings() {
  const t = useTranslations('fnb.cfg');
  const tf = useTranslations('fnb');
  const toast = useToast();
  const qc = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const menu = useMenuAll();
  const [draft, setDraft] = useState<Draft | null>(null);
  const stations = menu.data?.stations ?? [];
  const outputLabel = (o: Station['output']) => (o === 'kds' ? tf('outputKds') : o === 'printer' ? tf('outputPrinter') : tf('outputBoth'));

  const save = useMutation({
    mutationFn: (d: Draft) => fnbApi.saveStation(d),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fnbKeys.menu });
      void qc.invalidateQueries({ queryKey: fnbKeys.menuAll });
      toast.success(t('saved'));
      setDraft(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }} spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t('stationsHint')}
        </Typography>
        <GlassButton size="small" startIcon={<AddIcon />} onClick={() => setDraft({ name: '', name_en: '', output: 'kds', printer_name: '', sort: stations.length, is_active: true })} data-testid="cfg-add-station">
          {t('addStation')}
        </GlassButton>
      </Stack>
      <GlassTable
        columns={[
          { key: 'name', label: t('name'), render: (s: Station) => (s.is_active ? s.name : <span style={{ opacity: 0.55 }}>{s.name}</span>) },
          { key: 'output', label: t('output'), render: (s: Station) => outputLabel(s.output) },
          { key: 'printer', label: t('printerName'), render: (s: Station) => s.printer_name || '—' },
          { key: 'sort', label: t('sort'), align: 'right', render: (s: Station) => s.sort },
          {
            key: 'edit',
            label: '',
            align: 'right',
            width: 48,
            render: (s: Station) => (
              <IconButton size="small" onClick={() => setDraft({ ...s })} aria-label="edit" data-testid={`cfg-edit-station-${s.id}`}>
                <EditIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]}
        rows={stations}
        rowKey={(s) => s.id}
        loading={menu.isPending}
        emptyText={t('noStations')}
        size="small"
      />
      {draft && (
        <GlassDialog
          open
          onClose={() => setDraft(null)}
          title={draft.id ? t('editStation') : t('addStation')}
          maxWidth="xs"
          actions={
            <>
              <GlassButton variant="text" onClick={() => setDraft(null)}>
                {t('cancel')}
              </GlassButton>
              <GlassButton onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!draft.name.trim()} data-testid="cfg-save-station">
                {t('save')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <GlassInput label={t('name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus data-testid="cfg-station-name" />
            <GlassInput label={t('nameEn')} value={draft.name_en ?? ''} onChange={(e) => setDraft({ ...draft, name_en: e.target.value })} />
            <GlassInput select label={t('output')} value={draft.output} onChange={(e) => setDraft({ ...draft, output: e.target.value as Station['output'] })} data-testid="cfg-station-output">
              <MenuItemOption value="kds">{tf('outputKds')}</MenuItemOption>
              <MenuItemOption value="printer">{tf('outputPrinter')}</MenuItemOption>
              <MenuItemOption value="both">{tf('outputBoth')}</MenuItemOption>
            </GlassInput>
            {draft.output !== 'kds' && <GlassInput label={t('printerName')} value={draft.printer_name ?? ''} onChange={(e) => setDraft({ ...draft, printer_name: e.target.value })} helperText={t('printerNameHint')} />}
            <GlassInput label={t('sort')} type="number" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) })} />
            <FormControlLabel control={<Checkbox checked={draft.is_active} onChange={(_, on) => setDraft({ ...draft, is_active: on })} />} label={t('active')} />
          </Stack>
        </GlassDialog>
      )}
    </Box>
  );
}
