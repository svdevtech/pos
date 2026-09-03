'use client';

import AddIcon from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { useApiErrorMessage } from '@/lib/api/errors';

export interface LookupOption {
  id: string;
  name: string;
  name_en?: string;
  is_active?: boolean;
}

export interface LookupSelectProps {
  label: string;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  options: readonly LookupOption[];
  loading?: boolean;
  /** When given, shows a "+" button that opens a name / name (EN) dialog. */
  onCreate?: (input: { name: string; name_en: string }) => Promise<LookupOption>;
  createTitle?: string;
  /** Hide the "none" option (required selects). */
  required?: boolean;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  size?: 'small' | 'medium';
  /** Ask for an English name too (default true). */
  withNameEn?: boolean;
}

/** Select bound to a lookup list (category, unit, supplier, …) with optional inline create. */
export default function LookupSelect({
  label,
  value,
  onChange,
  options,
  loading,
  onCreate,
  createTitle,
  required,
  error,
  helperText,
  disabled,
  size = 'medium',
  withNameEn = true,
}: LookupSelectProps) {
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const locale = useLocale();
  const errorMessage = useApiErrorMessage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const display = (o: LookupOption) => (locale === 'en' && o.name_en ? o.name_en : o.name);
  const current = value ?? '';
  const known = options.some((o) => o.id === current);

  const submit = async () => {
    if (!onCreate) return;
    if (!name.trim()) {
      setFormError(tv('required'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const created = await onCreate({ name: name.trim(), name_en: nameEn.trim() });
      onChange(created.id);
      setOpen(false);
      setName('');
      setNameEn('');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ width: '100%' }}>
        <GlassInput
          select
          size={size}
          label={label}
          value={known || current === '' ? current : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          disabled={disabled || loading}
          error={error}
          helperText={helperText}
          SelectProps={{ displayEmpty: !required }}
          InputLabelProps={{ shrink: true }}
        >
          {!required && (
            <MenuItem value="">
              <em>{tc('none')}</em>
            </MenuItem>
          )}
          {options.map((o) => (
            <MenuItem key={o.id} value={o.id} disabled={o.is_active === false && o.id !== current}>
              {display(o)}
            </MenuItem>
          ))}
        </GlassInput>
        {onCreate && !disabled && (
          <Tooltip title={createTitle ?? tc('add')}>
            <IconButton
              aria-label={createTitle ?? tc('add')}
              onClick={() => {
                setFormError(null);
                setOpen(true);
              }}
              sx={{ mt: size === 'small' ? 0.25 : 1, border: (th) => `1px solid ${th.glass.border}`, borderRadius: 3 }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {onCreate && (
        <GlassDialog
          open={open}
          onClose={() => setOpen(false)}
          busy={saving}
          maxWidth="xs"
          title={createTitle ?? tc('add')}
          actions={
            <>
              <GlassButton variant="outlined" onClick={() => setOpen(false)} disabled={saving}>
                {tc('cancel')}
              </GlassButton>
              <GlassButton onClick={() => void submit()} loading={saving}>
                {tc('create')}
              </GlassButton>
            </>
          }
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <GlassInput
              autoFocus
              label={tc('name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            {withNameEn && <GlassInput label={`${tc('name')} (EN)`} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />}
          </Stack>
        </GlassDialog>
      )}
    </>
  );
}
