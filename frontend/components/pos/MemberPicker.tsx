'use client';

import PersonIcon from '@mui/icons-material/Person';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { formatMoney } from '@/lib/format';
import { posApi } from '@/lib/pos/api';
import type { Member } from '@/lib/pos/types';

interface Props {
  member: Member | null;
  onChange: (member: Member | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compact?: boolean;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function MemberChip({ member, onClick, onClear }: { member: Member | null; onClick: () => void; onClear?: () => void }) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  if (!member) {
    return <Chip icon={<PersonIcon />} label={`${t('walkIn')} · F3`} onClick={onClick} variant="outlined" data-testid="member-chip" />;
  }
  const arBalance = member.ar_balance !== undefined ? formatMoney(member.ar_balance, locale) : null;
  return (
    <Chip
      icon={<PersonIcon />}
      color="primary"
      onClick={onClick}
      onDelete={onClear}
      data-testid="member-chip"
      label={
        <Stack direction="row" spacing={1} alignItems="center">
          <span>
            <b>{member.member_code}</b> {member.name}
          </span>
          <Typography component="span" variant="caption" sx={{ opacity: 0.85 }}>
            {t('shareCapital')} {formatMoney(member.share_capital, locale)}
            {arBalance ? ` · ${t('arBalance')} ${arBalance}` : ''}
          </Typography>
        </Stack>
      }
      sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden' } }}
    />
  );
}

/** Member search dialog (F3). */
export default function MemberPicker({ member, onChange, open, onOpenChange }: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);

  useEffect(() => {
    if (open) setQ('');
  }, [open]);

  const search = useQuery({
    queryKey: ['members', 'search', dq],
    queryFn: () => posApi.searchMembers(dq, 15),
    enabled: open && dq.length >= 1,
    staleTime: 15_000,
  });

  const pick = (m: Member) => {
    onChange(m);
    onOpenChange(false);
  };

  const results = search.data ?? [];

  return (
    <GlassDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={t('selectMember')}
      maxWidth="sm"
      actions={
        <>
          {member && (
            <GlassButton
              variant="outlined"
              color="warning"
              onClick={() => {
                onChange(null);
                onOpenChange(false);
              }}
            >
              {t('useWalkIn')}
            </GlassButton>
          )}
          <GlassButton variant="text" onClick={() => onOpenChange(false)}>
            {t('close')}
          </GlassButton>
        </>
      }
    >
      <Box sx={{ pt: 1 }}>
        <GlassInput
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('memberSearchPlaceholder')}
          inputProps={{ 'data-testid': 'member-search' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length === 1) pick(results[0]);
          }}
          InputProps={{ startAdornment: <PersonSearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
        />
        <Box sx={{ minHeight: 200, mt: 1 }}>
          {search.isFetching && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!search.isFetching && dq && results.length === 0 && (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              {t('noMembers')}
            </Typography>
          )}
          {!search.isFetching && !dq && (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              {t('memberSearchHint')}
            </Typography>
          )}
          {!search.isFetching && results.length > 0 && (
            <List dense disablePadding>
              {results.map((m) => (
                <ListItemButton key={m.id} onClick={() => pick(m)} selected={member?.id === m.id} sx={{ borderRadius: 2 }}>
                  <ListItemText
                    primary={
                      <span>
                        <b>{m.member_code}</b> {m.name}
                        {m.is_walkin && (
                          <Chip size="small" label={t('walkIn')} sx={{ ml: 1, height: 18 }} />
                        )}
                      </span>
                    }
                    secondary={`${m.phone ? `${m.phone} · ` : ''}${t('shareCapital')} ${formatMoney(m.share_capital, locale)}${
                      m.ar_balance !== undefined ? ` · ${t('arBalance')} ${formatMoney(m.ar_balance, locale)}` : ''
                    }${m.price_tier > 1 ? ` · ${t('priceTier', { tier: m.price_tier })}` : ''}`}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </Box>
    </GlassDialog>
  );
}
