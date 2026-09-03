'use client';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { GlassInput } from '@/components/glass';
import { searchMembers, type Member } from '@/lib/api/hooks/members';

export interface MemberAutocompleteProps {
  value: Member | null;
  onChange: (member: Member | null) => void;
  label?: string;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  size?: 'small' | 'medium';
}

/** Async member search (`GET /members/search?q=`) with a 250 ms debounce. */
export default function MemberAutocomplete({
  value,
  onChange,
  label,
  error,
  helperText,
  disabled,
  autoFocus,
  size = 'medium',
}: MemberAutocompleteProps) {
  const t = useTranslations('members');
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    const timer = setTimeout(() => {
      searchMembers(input.trim(), controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setOptions(items);
        })
        .catch(() => {
          if (!controller.signal.aborted) setOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input]);

  return (
    <Autocomplete<Member, false, false, false>
      value={value}
      onChange={(_, next) => onChange(next)}
      inputValue={input}
      onInputChange={(_, next) => setInput(next)}
      options={options}
      loading={loading}
      disabled={disabled}
      size={size}
      filterOptions={(x) => x}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(m) => `${m.member_code} · ${m.name}`}
      noOptionsText={t('noMembers')}
      loadingText={t('searching')}
      renderOption={(props, m) => (
        <Box component="li" {...props} key={m.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {m.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {m.member_code}
              {m.phone ? ` · ${m.phone}` : ''}
            </Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <GlassInput
          {...params}
          label={label ?? t('search')}
          error={error}
          helperText={helperText}
          autoFocus={autoFocus}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
