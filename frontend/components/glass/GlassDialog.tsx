'use client';

import CloseIcon from '@mui/icons-material/Close';
import Dialog, { type DialogProps } from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import type { ReactNode } from 'react';

export interface GlassDialogProps extends Omit<DialogProps, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  /** Disable the close icon / backdrop while a mutation runs. */
  busy?: boolean;
}

export default function GlassDialog({
  title,
  actions,
  onClose,
  busy = false,
  children,
  maxWidth = 'sm',
  fullWidth = true,
  ...rest
}: GlassDialogProps) {
  return (
    <Dialog
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      onClose={busy ? undefined : onClose}
      PaperProps={{ sx: { backgroundImage: 'none' } }}
      {...rest}
    >
      {title && (
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
          {title}
          {onClose && (
            <IconButton aria-label="close" onClick={onClose} disabled={busy} size="small" edge="end">
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </DialogTitle>
      )}
      <DialogContent dividers sx={{ borderColor: 'divider' }}>
        {children}
      </DialogContent>
      {actions && <DialogActions sx={{ px: 3, py: 2 }}>{actions}</DialogActions>}
    </Dialog>
  );
}
