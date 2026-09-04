'use client';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useEffect, useState } from 'react';
import { posApi } from '@/lib/pos/api';

interface Props {
  slipId: string;
  height?: number;
  alt: string;
  onClick?: () => void;
}

/**
 * A stored slip photograph.
 *
 * The image endpoint needs the bearer token, so a plain `<img src>` would come back 401. The bytes
 * are fetched through the API client and shown from an object URL, which is released on unmount.
 */
export default function SlipImage({ slipId, height = 96, alt, onClick }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    posApi
      .slipImage(slipId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [slipId]);

  if (failed) return null;
  if (!url) {
    return (
      <Box sx={{ height, width: height * 0.75, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={18} />
      </Box>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      onClick={onClick}
      data-testid="slip-image"
      style={{ height, borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', cursor: onClick ? 'zoom-in' : 'default', objectFit: 'cover' }}
    />
  );
}
