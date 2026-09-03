'use client';

import Alert, { type AlertColor } from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: string;
  severity: AlertColor;
  duration: number;
}

export interface ToastApi {
  show: (message: string, severity?: AlertColor, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;

/** Queue-based snackbar host; mount once (see Providers). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [open, setOpen] = useState(false);

  const show = useCallback((message: string, severity: AlertColor = 'info', duration = 3500) => {
    seq += 1;
    setQueue((q) => [...q, { id: seq, message, severity, duration }]);
    setOpen(true);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, 'success'),
      error: (m) => show(m, 'error', 5000),
      info: (m) => show(m, 'info'),
      warning: (m) => show(m, 'warning', 4500),
    }),
    [show],
  );

  const current = queue[0];

  const handleClose = (_: unknown, reason?: string) => {
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  const handleExited = () => {
    setQueue((q) => q.slice(1));
    if (queue.length > 1) setOpen(true);
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={current?.id}
        open={open && Boolean(current)}
        autoHideDuration={current?.duration ?? 3500}
        onClose={handleClose}
        TransitionProps={{ onExited: handleExited }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setOpen(false)}
          severity={current?.severity ?? 'info'}
          variant="filled"
          sx={{ width: '100%', minWidth: 280 }}
        >
          {current?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
