'use client';

import AddIcon from '@mui/icons-material/Add';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { STATUS_COLOR } from '@/components/fnb/floorStatus';
import { GlassButton, GlassCard, GlassDialog, GlassInput } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { useApiErrorMessage } from '@/lib/api/errors';
import { fnbApi, fnbKeys, type Reservation } from '@/lib/fnb/api';
import { useFnb } from '@/lib/fnb/store';

type Draft = { kind: 'reservation' | 'waitlist'; name: string; phone: string; party_size: number; at: string; note: string };

const STATUS_CHIP: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error'> = { booked: 'primary', waiting: 'warning', seated: 'success', cancelled: 'default', no_show: 'error' };

/**
 * The reservation book for a day and the walk-in waitlist. Seating a party picks a table and
 * opens it for them (the floor turns "seated"; the table's QR can take their order).
 */
export default function ReservationsPage() {
  const t = useTranslations('fnb.res');
  const tf = useTranslations('fnb');
  const toast = useToast();
  const qc = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { floor, tableStatus } = useFnb();
  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const list = useQuery({ queryKey: fnbKeys.reservations(date), queryFn: () => fnbApi.reservations(date), refetchInterval: 30_000 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [seating, setSeating] = useState<Reservation | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['fnb', 'reservations'] });
    void qc.invalidateQueries({ queryKey: fnbKeys.orders(true) });
  };
  const save = useMutation({
    mutationFn: (d: Draft) => fnbApi.saveReservation({ kind: d.kind, name: d.name, phone: d.phone, party_size: d.party_size, at: d.kind === 'reservation' ? dayjs(d.at).toISOString() : new Date().toISOString(), note: d.note }),
    onSuccess: () => {
      invalidate();
      toast.success(t('saved'));
      setDraft(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string; table_code?: string }) => fnbApi.setReservationStatus(v.id, v.status, v.table_code),
    onSuccess: () => {
      invalidate();
      setSeating(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = list.data ?? [];
  const bookings = rows.filter((r) => r.kind === 'reservation');
  const waiting = rows.filter((r) => r.kind === 'waitlist' && r.status === 'waiting');
  const fmtTime = (iso: string) => dayjs(iso).format('HH:mm');

  const card = (r: Reservation) => (
    <Box key={r.id} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', opacity: r.status === 'cancelled' || r.status === 'no_show' ? 0.5 : 1 }} data-testid={`res-${r.id}`}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Typography variant="h6" fontWeight={900} sx={{ minWidth: 60, fontVariantNumeric: 'tabular-nums' }}>
          {fmtTime(r.at)}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>
            {r.name} · {tf('seats', { n: r.party_size })}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {[r.phone, r.note, r.table_code ? `${tf('table')} ${r.table_code}` : ''].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Chip size="small" label={t(`status_${r.status}`)} color={STATUS_CHIP[r.status] ?? 'default'} />
        {(r.status === 'booked' || r.status === 'waiting') && (
          <>
            <GlassButton size="small" startIcon={<EventSeatIcon />} onClick={() => setSeating(r)} data-testid={`res-seat-${r.id}`}>
              {t('seat')}
            </GlassButton>
            <GlassButton size="small" variant="text" color="warning" onClick={() => setStatus.mutate({ id: r.id, status: r.kind === 'reservation' ? 'no_show' : 'cancelled' })}>
              {r.kind === 'reservation' ? t('noShow') : t('cancel')}
            </GlassButton>
          </>
        )}
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <GlassInput type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 170 }} />
        <Box sx={{ flex: 1 }} />
        <GlassButton size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDraft({ kind: 'waitlist', name: '', phone: '', party_size: 2, at: '', note: '' })} data-testid="res-add-wait">
          {t('addWaitlist')}
        </GlassButton>
        <GlassButton size="small" startIcon={<AddIcon />} onClick={() => setDraft({ kind: 'reservation', name: '', phone: '', party_size: 2, at: dayjs(date).hour(18).minute(0).format('YYYY-MM-DDTHH:mm'), note: '' })} data-testid="res-add">
          {t('addBooking')}
        </GlassButton>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <GlassCard title={`${t('bookings')} · ${bookings.length}`}>
          <Stack spacing={1}>
            {bookings.length === 0 && <Typography color="text.secondary">{t('noBookings')}</Typography>}
            {bookings.map(card)}
          </Stack>
        </GlassCard>
        <GlassCard title={`${t('waitlist')} · ${waiting.length}`}>
          <Stack spacing={1}>
            {waiting.length === 0 && <Typography color="text.secondary">{t('noWaiting')}</Typography>}
            {waiting.map(card)}
          </Stack>
        </GlassCard>
      </Box>

      {draft && (
        <GlassDialog
          open
          onClose={() => setDraft(null)}
          title={draft.kind === 'reservation' ? t('addBooking') : t('addWaitlist')}
          maxWidth="xs"
          actions={
            <>
              <GlassButton variant="text" onClick={() => setDraft(null)}>
                {t('cancel')}
              </GlassButton>
              <GlassButton onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!draft.name.trim()} data-testid="res-save">
                {t('save')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <GlassInput label={t('name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus data-testid="res-name" />
            <GlassInput label={t('phone')} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            <GlassInput label={t('partySize')} type="number" value={draft.party_size} onChange={(e) => setDraft({ ...draft, party_size: Number(e.target.value) })} inputProps={{ min: 1 }} />
            {draft.kind === 'reservation' && <GlassInput label={t('time')} type="datetime-local" value={draft.at} onChange={(e) => setDraft({ ...draft, at: e.target.value })} InputLabelProps={{ shrink: true }} />}
            <GlassInput label={t('note')} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </Stack>
        </GlassDialog>
      )}

      {seating && (
        <GlassDialog
          open
          onClose={() => setSeating(null)}
          title={`${t('seat')} · ${seating.name} · ${tf('seats', { n: seating.party_size })}`}
          maxWidth="sm"
          actions={
            <GlassButton variant="text" onClick={() => setSeating(null)}>
              {t('cancel')}
            </GlassButton>
          }
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('seatHint')}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {floor.tables.map((tb) => {
              const st = tableStatus(tb.id);
              return <Chip key={tb.id} label={`${tb.name} · ${tf('seats', { n: tb.seats })}`} clickable onClick={() => setStatus.mutate({ id: seating.id, status: 'seated', table_code: tb.name })} sx={{ fontWeight: 700, fontSize: 15, py: 2.2, borderColor: STATUS_COLOR[st], color: st === 'free' ? STATUS_COLOR[st] : 'text.disabled' }} variant="outlined" disabled={st !== 'free'} data-testid={`res-table-${tb.name}`} />;
            })}
          </Stack>
        </GlassDialog>
      )}
    </Box>
  );
}
