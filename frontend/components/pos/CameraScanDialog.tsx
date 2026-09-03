'use client';

import CameraswitchIcon from '@mui/icons-material/Cameraswitch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FlashlightOffIcon from '@mui/icons-material/FlashlightOff';
import FlashlightOnIcon from '@mui/icons-material/FlashlightOn';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassButton, GlassDialog } from '@/components/glass';
import {
  beep,
  cameraAllowedHere,
  cameraSupported,
  listCameras,
  ScanError,
  startCameraScan,
  type CameraOption,
  type ScanErrorKind,
  type ScannerControls,
} from '@/lib/pos/barcodeCamera';

/** What the POS screen did with a scanned code, shown as a running list inside the dialog. */
export interface CameraScanResult {
  ok: boolean;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Looks the code up and adds it to the cart. Returning `ok: false` shows the message in red. */
  onDetect: (code: string) => Promise<CameraScanResult>;
}

const CAMERA_KEY = 'pos.scanCamera';
/**
 * A symbol in front of the lens decodes many times a second, so one item would be added over and
 * over. It counts again only after leaving the frame for this long (or when another code is read).
 */
const RESCAN_GAP_MS = 1200;

export default function CameraScanDialog({ open, onClose, onDetect }: Props) {
  const t = useTranslations('pos');
  // MUI mounts dialog children through a portal on a later commit, so a plain ref would still be
  // null when the effect runs; the callback ref re-runs the effect once the element exists
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const lastCode = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busy = useRef(false);

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<ScanErrorKind | null>(null);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [log, setLog] = useState<CameraScanResult[]>([]);

  // remember the camera the cashier picked on this device
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CAMERA_KEY);
      if (saved) setDeviceId(saved);
    } catch {
      /* private mode */
    }
  }, []);

  // the parent re-renders on every cart change, so the handler is kept stable behind a ref —
  // otherwise the effect below would tear the camera down and back up between scans
  const detect = useRef(onDetect);
  detect.current = onDetect;

  const handleCode = useCallback(async (code: string) => {
    const now = Date.now();
    const seen = lastCode.current;
    // still the same symbol the camera has been staring at → not a new scan
    const stillInFrame = code === seen.code && now - seen.at < RESCAN_GAP_MS;
    lastCode.current = { code, at: now };
    if (stillInFrame || busy.current) return;
    busy.current = true;
    beep();
    try {
      const res = await detect.current(code);
      setLog((l) => [res, ...l].slice(0, 6));
    } finally {
      busy.current = false;
    }
  }, []);

  // start/stop the camera with the dialog
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const start = async (video: HTMLVideoElement) => {
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
        const controls = await startCameraScan(video, {
          deviceId,
          onCode: (code) => void handleCode(code),
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setHasTorch(Boolean(controls.setTorch));
        setCameras(await listCameras());
      } catch (err) {
        if (!cancelled) setError(err instanceof ScanError ? err.kind : 'unknown');
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    if (!videoEl) return;
    void start(videoEl);
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      setTorchOn(false);
    };
  }, [open, deviceId, handleCode, videoEl]);

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.deviceId === deviceId);
    const next = cameras[(idx + 1 + cameras.length) % cameras.length];
    try {
      window.localStorage.setItem(CAMERA_KEY, next.deviceId);
    } catch {
      /* private mode */
    }
    setDeviceId(next.deviceId); // restarts the effect
  };

  const toggleTorch = async () => {
    const setter = controlsRef.current?.setTorch;
    if (!setter) return;
    try {
      await setter(!torchOn);
      setTorchOn((v) => !v);
    } catch {
      setHasTorch(false);
    }
  };

  const errorText = error
    ? {
        permission: t('cameraDenied'),
        notfound: t('cameraNotFound'),
        insecure: t('cameraInsecure'),
        unknown: t('cameraFailed'),
      }[error]
    : null;

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      title={t('scanWithCamera')}
      actions={
        <GlassButton onClick={onClose} data-testid="camera-scan-done">
          {t('done')}
        </GlassButton>
      }
    >
      <Stack spacing={1.5}>
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4 / 3',
            borderRadius: 3,
            overflow: 'hidden',
            background: '#000',
          }}
          data-testid="camera-scan-view"
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live camera preview, no audio track */}
          <video ref={setVideoEl} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

          {/* aiming frame */}
          {!errorText && (
            <Box
              sx={{
                position: 'absolute',
                inset: '22% 10%',
                border: '2px solid rgba(255,255,255,0.85)',
                borderRadius: 2,
                boxShadow: '0 0 0 100vmax rgba(0,0,0,0.28)',
                pointerEvents: 'none',
              }}
            />
          )}

          {starting && !errorText && (
            <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0 }}>
              <CircularProgress size={28} />
            </Stack>
          )}

          <Stack direction="row" spacing={1} sx={{ position: 'absolute', right: 8, bottom: 8 }}>
            {hasTorch && (
              <Tooltip title={t('torch')}>
                <IconButton
                  onClick={() => void toggleTorch()}
                  sx={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
                  aria-label={t('torch')}
                >
                  {torchOn ? <FlashlightOnIcon /> : <FlashlightOffIcon />}
                </IconButton>
              </Tooltip>
            )}
            {cameras.length > 1 && (
              <Tooltip title={t('switchCamera')}>
                <IconButton
                  onClick={switchCamera}
                  sx={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
                  aria-label={t('switchCamera')}
                  data-testid="camera-scan-switch"
                >
                  <CameraswitchIcon />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Box>

        {errorText ? (
          <Alert severity="warning" data-testid="camera-scan-error">
            {errorText}
          </Alert>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('cameraScanHint')}
          </Typography>
        )}

        {log.length > 0 && (
          <Stack spacing={0.5} data-testid="camera-scan-log">
            {log.map((r, i) => (
              <Stack key={`${r.label}-${i}`} direction="row" spacing={1} alignItems="center">
                {r.ok ? <CheckCircleIcon color="success" fontSize="small" /> : <ErrorOutlineIcon color="error" fontSize="small" />}
                <Typography variant="body2" color={r.ok ? 'text.primary' : 'error.main'} sx={{ opacity: i === 0 ? 1 : 0.65 }}>
                  {r.label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </GlassDialog>
  );
}
