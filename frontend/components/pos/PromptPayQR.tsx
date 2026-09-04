'use client';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { QrMatrix } from '@/lib/pos/qrPayload';

interface Props {
  /** EMVCo payload string from the server. */
  payload: string;
  /** Rendered edge in pixels. */
  size?: number;
  caption?: string;
}

/**
 * The scannable code itself.
 *
 * The encoder lives in ZXing, which is ~250 kB, so it is imported only when a cashier actually
 * picks the QR tender — the till's first paint must stay light on a tablet.
 *
 * It is drawn on a white plate with a quiet margin even in dark mode: banking apps read a
 * displayed code by contrast, and an inverted QR on a dark glass panel often fails to scan.
 */
export default function PromptPayQR({ payload, size = 240, caption }: Props) {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMatrix(null);
    setFailed(false);
    import('@/lib/pos/qrPayload')
      .then(({ qrPath }) => {
        if (cancelled) return;
        setMatrix(qrPath(payload));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (failed) {
    return (
      <Typography variant="body2" color="error" data-testid="qr-error">
        {caption}
      </Typography>
    );
  }

  if (!matrix) {
    return (
      <Box sx={{ width: size, height: size, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Stack alignItems="center" spacing={1}>
      <Box
        sx={{ background: '#fff', borderRadius: 2, p: 1.5, lineHeight: 0, boxShadow: '0 6px 20px rgba(0,0,0,0.18)' }}
        data-testid="promptpay-qr"
        data-payload={payload}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${matrix.size} ${matrix.size}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={caption ?? 'PromptPay QR'}
        >
          <rect width={matrix.size} height={matrix.size} fill="#fff" />
          <path d={matrix.path} fill="#000" />
        </svg>
      </Box>
      {caption && (
        <Typography variant="caption" color="text.secondary" textAlign="center">
          {caption}
        </Typography>
      )}
    </Stack>
  );
}
