'use client';

import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CameraswitchIcon from '@mui/icons-material/Cameraswitch';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import ReplayIcon from '@mui/icons-material/Replay';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { GlassButton, GlassDialog } from '@/components/glass';
import { ScanError, cameraAllowedHere, cameraSupported, listCameras, type CameraOption, type ScanErrorKind } from '@/lib/pos/barcodeCamera';
import { shrinkImageFile, startPhotoCamera, type CapturedPhoto, type PhotoCameraControls } from '@/lib/pos/photoCapture';

const CAMERA_KEY = 'pos.slipCamera';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Handed the shrunk photograph; the caller decides when to upload it. */
  onCapture: (photo: CapturedPhoto) => void;
  /** Shown above the preview so the cashier can check the slip is for this bill. */
  amountLabel?: string;
}

/**
 * Photographing the customer's payment confirmation.
 *
 * Two ways in, because tills differ: the tablet's own camera pointed at the customer's phone, or
 * the file picker (a webcam on a desktop till, or a screenshot the customer sent by LINE). The
 * picture is shrunk before it leaves the browser.
 */
export default function SlipCaptureDialog({ open, onClose, onCapture, amountLabel }: Props) {
  const t = useTranslations('pos');
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const controls = useRef<PhotoCameraControls | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<ScanErrorKind | null>(null);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [shot, setShot] = useState<CapturedPhoto | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CAMERA_KEY);
      if (saved) setDeviceId(saved);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (open) setShot(null);
  }, [open]);

  // The camera runs only while the dialog is open and no picture has been taken yet: a frozen
  // preview next to a live stream confuses the cashier, and it keeps the lamp off.
  useEffect(() => {
    if (!open || shot || !videoEl) return;
    let cancelled = false;
    const start = async () => {
      setStarting(true);
      setError(null);
      if (!cameraSupported()) {
        setError('notfound');
        setStarting(false);
        return;
      }
      if (!cameraAllowedHere()) {
        setError('insecure');
        setStarting(false);
        return;
      }
      try {
        const c = await startPhotoCamera(videoEl, deviceId);
        if (cancelled) {
          c.stop();
          return;
        }
        controls.current = c;
        setCameras(await listCameras());
      } catch (err) {
        if (!cancelled) setError(err instanceof ScanError ? err.kind : 'unknown');
      } finally {
        if (!cancelled) setStarting(false);
      }
    };
    void start();
    return () => {
      cancelled = true;
      controls.current?.stop();
      controls.current = null;
    };
  }, [open, shot, videoEl, deviceId]);

  const take = () => {
    const photo = controls.current?.capture();
    if (photo) setShot(photo);
  };

  const pickFile = async (file: File) => {
    setError(null);
    try {
      setShot(await shrinkImageFile(file));
    } catch {
      setError('unknown');
    }
  };

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.deviceId === deviceId);
    const next = cameras[(idx + 1 + cameras.length) % cameras.length];
    try {
      window.localStorage.setItem(CAMERA_KEY, next.deviceId);
    } catch {
      /* private mode */
    }
    setDeviceId(next.deviceId);
  };

  const errorText = error
    ? { permission: t('cameraDenied'), notfound: t('cameraNotFound'), insecure: t('cameraInsecure'), unknown: t('cameraFailed') }[error]
    : null;

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      title={t('slipCaptureTitle')}
      actions={
        <>
          <GlassButton variant="text" onClick={onClose}>
            {t('cancelAction')}
          </GlassButton>
          {shot ? (
            <>
              <GlassButton variant="outlined" startIcon={<ReplayIcon />} onClick={() => setShot(null)} data-testid="slip-retake">
                {t('slipRetake')}
              </GlassButton>
              <GlassButton
                onClick={() => {
                  onCapture(shot);
                  onClose();
                }}
                data-testid="slip-use"
              >
                {t('slipUsePhoto')}
              </GlassButton>
            </>
          ) : (
            <GlassButton startIcon={<CameraAltIcon />} onClick={take} disabled={Boolean(error) || starting} data-testid="slip-shutter">
              {t('slipTakePhoto')}
            </GlassButton>
          )}
        </>
      }
    >
      <Stack spacing={1.5}>
        {amountLabel && (
          <Typography variant="body2" color="text.secondary">
            {amountLabel}
          </Typography>
        )}
        {errorText && <Alert severity="warning">{errorText}</Alert>}

        <Box
          sx={{
            position: 'relative',
            borderRadius: 2,
            overflow: 'hidden',
            background: '#000',
            aspectRatio: '3 / 4',
            maxHeight: '55vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shot.dataUrl}
              alt={t('slipCaptureTitle')}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              data-testid="slip-preview"
            />
          ) : (
            <>
              <video ref={setVideoEl} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} data-testid="slip-video" />
              {starting && !error && <CircularProgress size={28} sx={{ position: 'absolute' }} />}
              {cameras.length > 1 && (
                <Tooltip title={t('switchCamera')}>
                  <IconButton
                    onClick={switchCamera}
                    sx={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(0,0,0,0.45)', color: '#fff' }}
                    aria-label={t('switchCamera')}
                  >
                    <CameraswitchIcon />
                  </IconButton>
                </Tooltip>
              )}
            </>
          )}
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <GlassButton variant="text" size="small" startIcon={<PhotoLibraryIcon />} onClick={() => fileRef.current?.click()} data-testid="slip-pick-file">
            {t('slipChooseFile')}
          </GlassButton>
          {shot && (
            <Typography variant="caption" color="text.secondary">
              {shot.width}×{shot.height} · {Math.round(shot.bytes / 1024)} KB
            </Typography>
          )}
        </Stack>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          data-testid="slip-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void pickFile(f);
          }}
        />
      </Stack>
    </GlassDialog>
  );
}
