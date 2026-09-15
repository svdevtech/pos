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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import FloorPlan2D from '@/components/fnb/FloorPlan2D';
import { floorSize, type FloorData } from '@/components/fnb/floorStatus';
import { GlassButton, GlassCard, GlassDialog, GlassInput, GlassTable } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { useApiErrorMessage } from '@/lib/api/errors';
import { fnbApi, fnbKeys, type FloorTable, type FloorZone } from '@/lib/fnb/api';
import type { Table } from '@/lib/fnb/types';
import { dec } from '@/lib/pos/types';

type ZoneDraft = Omit<FloorZone, 'id'> & { id?: string };
type TableDraft = Omit<FloorTable, 'id' | 'x' | 'y'> & { id?: string; x: string; y: string };

const SHAPES: FloorTable['shape'][] = ['round', 'square', 'long'];

/**
 * The room: zones, and tables placed on a to-scale plan. Pick a table in the list and tap the
 * plan to put it there; a table that exists is moved at once, a new one is placed before its
 * first save.
 */
export default function FloorSettings() {
  const t = useTranslations('fnb.cfg');
  const toast = useToast();
  const qc = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const floorQ = useQuery({ queryKey: fnbKeys.floorAll, queryFn: () => fnbApi.floor(true), staleTime: 30_000 });
  const zones = floorQ.data?.zones ?? [];
  const tables = floorQ.data?.tables ?? [];
  const zoneName = Object.fromEntries(zones.map((z) => [z.id, z.name]));

  const [zone, setZone] = useState<ZoneDraft | null>(null);
  const [draft, setDraft] = useState<TableDraft | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: fnbKeys.floor });
    void qc.invalidateQueries({ queryKey: fnbKeys.floorAll });
    void qc.invalidateQueries({ queryKey: fnbKeys.tables });
  };
  const saveZone = useMutation({
    mutationFn: (z: ZoneDraft) => fnbApi.saveZone(z),
    onSuccess: () => {
      invalidate();
      toast.success(t('saved'));
      setZone(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveTable = useMutation({
    mutationFn: (d: TableDraft) => fnbApi.saveTable({ ...d, x: d.x || '1', y: d.y || '1' }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(t('saved'));
      setDraft({ ...saved, x: String(saved.x), y: String(saved.y) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // the plan: active tables, with the one being edited drawn where the draft says
  const floor = useMemo<FloorData>(() => {
    const list: Table[] = (floorQ.data?.tables ?? [])
      .filter((x) => x.is_active && x.id !== draft?.id)
      .map((x) => ({ id: x.id, zoneId: x.zone_id ?? '', name: x.code, seats: x.seats, x: dec(x.x), y: dec(x.y), shape: x.shape, rotation: x.rotation || undefined }));
    if (draft) list.push({ id: draft.id ?? 'new', zoneId: draft.zone_id ?? '', name: draft.code || '?', seats: draft.seats, x: dec(draft.x || 1), y: dec(draft.y || 1), shape: draft.shape, rotation: draft.rotation || undefined });
    const zs = (floorQ.data?.zones ?? []).filter((z) => z.is_active).map((z) => ({ id: z.id, name: z.name, color: z.color }));
    return { zones: zs, tables: list, ...floorSize(list) };
  }, [floorQ.data, draft]);

  const newTable = (): TableDraft => ({ code: '', zone_id: zones[0]?.id ?? null, seats: 4, x: '1', y: '1', shape: 'square', rotation: 0, sort: tables.length, is_active: true });
  const edit = (x: FloorTable): TableDraft => ({ ...x, x: String(x.x), y: String(x.y) });
  const place = (x: number, y: number) => {
    if (!draft) return;
    const next = { ...draft, x: String(x), y: String(y) };
    setDraft(next);
    if (next.id && next.code.trim()) saveTable.mutate(next);
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '380px 1fr' }, gap: 2 }}>
      <Stack spacing={2}>
        <GlassCard
          title={t('zones')}
          action={
            <GlassButton size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setZone({ name: '', name_en: '', color: '#2b3d55', sort: zones.length, is_active: true })} data-testid="cfg-add-zone">
              {t('addZone')}
            </GlassButton>
          }
        >
          <GlassTable
            columns={[
              { key: 'color', label: '', width: 36, render: (z: FloorZone) => <Box sx={{ width: 18, height: 18, borderRadius: 1, bgcolor: z.color, border: '1px solid rgba(255,255,255,0.3)' }} /> },
              { key: 'name', label: t('name'), render: (z: FloorZone) => (z.is_active ? z.name : <span style={{ opacity: 0.55 }}>{z.name}</span>) },
              { key: 'n', label: t('tables'), align: 'right', render: (z: FloorZone) => tables.filter((x) => x.zone_id === z.id && x.is_active).length },
              {
                key: 'edit',
                label: '',
                align: 'right',
                width: 48,
                render: (z: FloorZone) => (
                  <IconButton size="small" onClick={() => setZone({ ...z })} aria-label="edit" data-testid={`cfg-edit-zone-${z.id}`}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                ),
              },
            ]}
            rows={zones}
            rowKey={(z) => z.id}
            loading={floorQ.isPending}
            emptyText={t('noZones')}
            size="small"
          />
        </GlassCard>
        <GlassCard
          title={t('tables')}
          action={
            <GlassButton size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDraft(newTable())} data-testid="cfg-add-table">
              {t('addTable')}
            </GlassButton>
          }
        >
          <GlassTable
            columns={[
              { key: 'code', label: t('code'), render: (x: FloorTable) => (x.is_active ? x.code : <span style={{ opacity: 0.55 }}>{x.code}</span>) },
              { key: 'zone', label: t('zone'), render: (x: FloorTable) => zoneName[x.zone_id ?? ''] ?? '—' },
              { key: 'seats', label: t('seats'), align: 'right', render: (x: FloorTable) => x.seats },
              { key: 'pos', label: 'x · y', align: 'right', render: (x: FloorTable) => `${dec(x.x)} · ${dec(x.y)}` },
            ]}
            rows={tables}
            rowKey={(x) => x.id}
            loading={floorQ.isPending}
            emptyText={t('noTables')}
            size="small"
            maxHeight={360}
            onRowClick={(x) => setDraft(edit(x))}
            isSelected={(x) => x.id === draft?.id}
          />
        </GlassCard>
      </Stack>

      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Box sx={{ borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider', aspectRatio: `${floor.width} / ${floor.depth}`, maxHeight: 420 }} data-testid="cfg-floor-preview">
          <FloorPlan2D floor={floor} statusOf={() => 'free'} selectedId={draft?.id ?? (draft ? 'new' : null)} onSelect={(id) => setDraft(edit(tables.find((x) => x.id === id) ?? tables[0]))} onPlace={draft ? place : undefined} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {t('placeHint')}
        </Typography>
        {draft && (
          <GlassCard title={draft.id ? `${t('editTable')} ${draft.code}` : t('addTable')} data-testid="cfg-table-form">
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <GlassInput label={t('code')} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} autoFocus={!draft.id} sx={{ minWidth: 120 }} data-testid="cfg-table-code" />
                <GlassInput select label={t('zone')} value={draft.zone_id ?? ''} onChange={(e) => setDraft({ ...draft, zone_id: e.target.value || null })} fullWidth>
                  <MenuItemOption value="">{t('noZone')}</MenuItemOption>
                  {zones.map((z) => (
                    <MenuItemOption key={z.id} value={z.id}>
                      {z.name}
                    </MenuItemOption>
                  ))}
                </GlassInput>
                <GlassInput label={t('seats')} type="number" value={draft.seats} onChange={(e) => setDraft({ ...draft, seats: Number(e.target.value) })} sx={{ minWidth: 100 }} />
                <GlassInput select label={t('shape')} value={draft.shape} onChange={(e) => setDraft({ ...draft, shape: e.target.value as FloorTable['shape'] })} sx={{ minWidth: 130 }}>
                  {SHAPES.map((s) => (
                    <MenuItemOption key={s} value={s}>
                      {t(`shape_${s}`)}
                    </MenuItemOption>
                  ))}
                </GlassInput>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                <GlassInput label="x (m)" type="number" value={draft.x} onChange={(e) => setDraft({ ...draft, x: e.target.value })} inputProps={{ step: 0.1, min: 0 }} sx={{ width: 110 }} />
                <GlassInput label="y (m)" type="number" value={draft.y} onChange={(e) => setDraft({ ...draft, y: e.target.value })} inputProps={{ step: 0.1, min: 0 }} sx={{ width: 110 }} />
                <GlassInput label={t('rotation')} type="number" value={draft.rotation} onChange={(e) => setDraft({ ...draft, rotation: Number(e.target.value) })} inputProps={{ step: 15 }} sx={{ width: 110 }} />
                <GlassInput label={t('sort')} type="number" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) })} sx={{ width: 100 }} />
                <FormControlLabel control={<Checkbox checked={draft.is_active} onChange={(_, on) => setDraft({ ...draft, is_active: on })} />} label={t('active')} sx={{ whiteSpace: 'nowrap' }} />
                <Box sx={{ flex: 1 }} />
                <GlassButton variant="text" onClick={() => setDraft(null)}>
                  {t('cancel')}
                </GlassButton>
                <GlassButton onClick={() => saveTable.mutate(draft)} loading={saveTable.isPending} disabled={!draft.code.trim()} data-testid="cfg-save-table">
                  {t('save')}
                </GlassButton>
              </Stack>
            </Stack>
          </GlassCard>
        )}
      </Stack>

      {zone && (
        <GlassDialog
          open
          onClose={() => setZone(null)}
          title={zone.id ? t('editZone') : t('addZone')}
          maxWidth="xs"
          actions={
            <>
              <GlassButton variant="text" onClick={() => setZone(null)}>
                {t('cancel')}
              </GlassButton>
              <GlassButton onClick={() => saveZone.mutate(zone)} loading={saveZone.isPending} disabled={!zone.name.trim()} data-testid="cfg-save-zone">
                {t('save')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <GlassInput label={t('name')} value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} autoFocus data-testid="cfg-zone-name" />
            <GlassInput label={t('nameEn')} value={zone.name_en ?? ''} onChange={(e) => setZone({ ...zone, name_en: e.target.value })} />
            <GlassInput label={t('color')} type="color" value={zone.color} onChange={(e) => setZone({ ...zone, color: e.target.value })} sx={{ width: 120 }} />
            <GlassInput label={t('sort')} type="number" value={zone.sort} onChange={(e) => setZone({ ...zone, sort: Number(e.target.value) })} />
            <FormControlLabel control={<Checkbox checked={zone.is_active} onChange={(_, on) => setZone({ ...zone, is_active: on })} />} label={t('active')} />
          </Stack>
        </GlassDialog>
      )}
    </Box>
  );
}
