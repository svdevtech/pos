'use client';

import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { GlassButton, GlassDialog } from '@/components/glass';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Body text or custom content (an extra field, for example). */
  message?: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  /** Colour of the confirm button; `error` for destructive actions. */
  color?: 'primary' | 'error' | 'warning';
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  color = 'primary',
  loading = false,
  disabled = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const tc = useTranslations('common');
  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={loading}
      maxWidth="xs"
      title={title}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={loading}>
            {cancelText ?? tc('cancel')}
          </GlassButton>
          <GlassButton color={color} onClick={onConfirm} loading={loading} disabled={disabled}>
            {confirmText ?? tc('confirm')}
          </GlassButton>
        </>
      }
    >
      {typeof message === 'string' ? <Typography variant="body2">{message}</Typography> : message}
    </GlassDialog>
  );
}
