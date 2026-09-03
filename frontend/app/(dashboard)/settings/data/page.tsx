'use client';

import BackupIcon from '@mui/icons-material/Backup';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import RestoreIcon from '@mui/icons-material/Restore';
import StorageIcon from '@mui/icons-material/Storage';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassDialog, GlassInput } from '@/components/glass';
import { useApiErrorMessage } from '@/lib/api/errors';
import {
  downloadBackup,
  useBackups,
  useCreateBackup,
  useDataJobs,
  useDeleteBackup,
  useDiscardLegacyDump,
  useLegacyDump,
  useRestore,
  useRunLegacyImport,
  useUploadLegacyDump,
  type DataJob,
  type LegacyReport,
  type RestoreReport,
} from '@/lib/api/hooks/dataops';
import { formatDateTime } from '@/lib/format';

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
};

function DataContent() {
  const t = useTranslations('data');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();

  const jobs = useDataJobs();
  const backups = useBackups();
  const legacy = useLegacyDump();

  const createBackup = useCreateBackup();
  const deleteBackup = useDeleteBackup();
  const restore = useRestore();
  const uploadDump = useUploadLegacyDump();
  const discardDump = useDiscardLegacyDump();
  const runImport = useRunLegacyImport();

  const [source, setSource] = useState<string>('');
  const [replace, setReplace] = useState(true);
  const [profile, setProfile] = useState(true);
  const [confirmRestore, setConfirmRestore] = useState<{ file?: File; name?: string } | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const dumpFileRef = useRef<HTMLInputElement>(null);

  const running = jobs.data?.find((j) => j.status === 'running');
  const busy = Boolean(running);
  const lastOf = (kind: DataJob['kind']) => jobs.data?.find((j) => j.kind === kind);

  const startRestore = () => {
    const target = confirmRestore;
    if (!target) return;
    restore.mutate(
      { name: target.name, file: target.file, replace, profile },
      {
        onSuccess: () => {
          toast.success(t('restoreStarted'));
          setConfirmRestore(null);
          setUnderstood(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const onPickDump = (file: File | undefined) => {
    if (!file) return;
    uploadDump.mutate(file, {
      onSuccess: () => toast.success(t('dumpUploaded')),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const legacyReport = lastOf('legacy_import')?.report as LegacyReport | undefined;
  const restoreReport = lastOf('restore')?.report as RestoreReport | undefined;

  return (
    <Stack spacing={3} sx={{ maxWidth: 1100 }}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} backHref="/settings" />

      {running && (
        <GlassCard>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2">{t(`kind.${running.kind}`)}</Typography>
              <Chip size="small" label={running.step || tc('loading')} />
              <Typography variant="caption" color="text.secondary">
                {running.progress ?? 0}%
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={running.progress ?? 0} />
            <Typography variant="caption" color="text.secondary">
              {t('jobRunningHint')}
            </Typography>
          </Stack>
        </GlassCard>
      )}

      {/* ---------------- backup ---------------- */}
      <GlassCard title={t('backupTitle')} subtitle={t('backupDesc')}>
        <Stack spacing={2}>
          <Box>
            <GlassButton startIcon={<BackupIcon />} onClick={() => createBackup.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })} disabled={busy} data-testid="backup-create">
              {t('createBackup')}
            </GlassButton>
          </Box>
          {backups.isLoading && <Skeleton variant="rounded" height={120} />}
          {backups.data && backups.data.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('noBackups')}
            </Typography>
          )}
          {backups.data && backups.data.length > 0 && (
            <Table size="small" data-testid="backup-list">
              <TableHead>
                <TableRow>
                  <TableCell>{t('fileName')}</TableCell>
                  <TableCell align="right">{t('size')}</TableCell>
                  <TableCell>{t('createdAt')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.data.map((f) => (
                  <TableRow key={f.name} hover>
                    <TableCell sx={{ wordBreak: 'break-all' }}>{f.name}</TableCell>
                    <TableCell align="right">{formatSize(f.size)}</TableCell>
                    <TableCell>{formatDateTime(f.created_at)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title={t('download')}>
                          <IconButton size="small" onClick={() => void downloadBackup(f.name).catch((e) => toast.error(errorMessage(e)))}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('restoreFromThis')}>
                          <span>
                            <IconButton size="small" disabled={busy} onClick={() => setConfirmRestore({ name: f.name })}>
                              <RestoreIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={tc('delete')}>
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={busy}
                              onClick={() => deleteBackup.mutate(f.name, { onError: (e) => toast.error(errorMessage(e)) })}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Stack>
      </GlassCard>

      {/* ---------------- restore ---------------- */}
      <GlassCard title={t('restoreTitle')} subtitle={t('restoreDesc')}>
        <Stack spacing={2}>
          <Alert severity="warning">{t('restoreWarning')}</Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <GlassInput
              select
              label={t('fromServer')}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              sx={{ minWidth: 280 }}
              disabled={!backups.data?.length}
            >
              {(backups.data ?? []).map((f) => (
                <MenuItem key={f.name} value={f.name}>
                  {f.name}
                </MenuItem>
              ))}
            </GlassInput>
            <GlassButton variant="outlined" startIcon={<RestoreIcon />} disabled={!source || busy} onClick={() => setConfirmRestore({ name: source })}>
              {t('restoreSelected')}
            </GlassButton>
            <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', sm: 'block' } }} />
            <GlassButton variant="outlined" startIcon={<UploadFileIcon />} disabled={busy} onClick={() => restoreFileRef.current?.click()}>
              {t('restoreFromFile')}
            </GlassButton>
            <input
              ref={restoreFileRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) setConfirmRestore({ file });
              }}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControlLabel control={<Checkbox checked={replace} onChange={(e) => setReplace(e.target.checked)} />} label={t('replaceLabel')} />
            <FormControlLabel control={<Checkbox checked={profile} onChange={(e) => setProfile(e.target.checked)} />} label={t('profileLabel')} />
          </Stack>
          {restoreReport && (
            <Alert severity={lastOf('restore')?.status === 'error' ? 'error' : 'success'}>
              {lastOf('restore')?.status === 'error'
                ? lastOf('restore')?.error
                : t('restoreDone', {
                    rows: Object.values(restoreReport.inserted ?? {}).reduce((a, b) => a + b, 0),
                    archive: restoreReport.archive || '',
                  })}
            </Alert>
          )}
        </Stack>
      </GlassCard>

      {/* ---------------- legacy import ---------------- */}
      <GlassCard title={t('legacyTitle')} subtitle={t('legacyDesc')}>
        <Stack spacing={2}>
          <Stack component="ol" spacing={1} sx={{ pl: 3, m: 0 }}>
            <Typography component="li" variant="body2">
              {t.rich('legacyStep1', {
                link: (chunks) => (
                  <a href="/legacy/extract.ps1" download>
                    {chunks}
                  </a>
                ),
                code: (chunks) => (
                  <Box component="code" sx={{ display: 'block', mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'action.hover', fontSize: 12, wordBreak: 'break-all' }}>
                    {chunks}
                  </Box>
                ),
              })}
            </Typography>
            <Typography component="li" variant="body2">
              {t('legacyStep2')}
            </Typography>
            <Typography component="li" variant="body2">
              {t('legacyStep3')}
            </Typography>
          </Stack>

          <Box>
            <GlassButton variant="outlined" startIcon={<UploadFileIcon />} disabled={busy || uploadDump.isPending} loading={uploadDump.isPending} onClick={() => dumpFileRef.current?.click()} data-testid="legacy-upload">
              {t('uploadDump')}
            </GlassButton>
            <input
              ref={dumpFileRef}
              type="file"
              accept=".zip,.gz,.tgz,.tar"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                onPickDump(file);
              }}
            />
          </Box>

          {legacy.data && (
            <Stack spacing={1} data-testid="legacy-dump">
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip color="success" size="small" label={legacy.data.file_name} />
                <Typography variant="caption" color="text.secondary">
                  {formatSize(legacy.data.size_bytes)} · {formatDateTime(legacy.data.uploaded_at)}
                </Typography>
                <GlassButton size="small" variant="text" color="error" disabled={busy} onClick={() => discardDump.mutate()}>
                  {tc('delete')}
                </GlassButton>
              </Stack>
              <Box sx={{ maxHeight: 180, overflowY: 'auto' }}>
                <Table size="small">
                  <TableBody>
                    {Object.entries(legacy.data.tables)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 12)
                      .map(([name, rows]) => (
                        <TableRow key={name}>
                          <TableCell>{name}</TableCell>
                          <TableCell align="right">{rows.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </Box>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <GlassButton
                  variant="outlined"
                  disabled={busy}
                  onClick={() => runImport.mutate(true, { onSuccess: () => toast.success(t('importStarted')), onError: (e) => toast.error(errorMessage(e)) })}
                  data-testid="legacy-dry-run"
                >
                  {t('dryRun')}
                </GlassButton>
                <GlassButton startIcon={<StorageIcon />} disabled={busy} onClick={() => setConfirmImport(true)} data-testid="legacy-import">
                  {t('runImport')}
                </GlassButton>
              </Stack>
            </Stack>
          )}

          {legacyReport && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">
                {legacyReport.dry_run ? t('lastDryRun') : t('lastImport')} · {formatDateTime(legacyReport.finished_at)}
              </Typography>
              <Table size="small" data-testid="legacy-report">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('stage')}</TableCell>
                    <TableCell align="right">{t('rowsIn')}</TableCell>
                    <TableCell align="right">{t('rowsOut')}</TableCell>
                    <TableCell align="right">{t('skipped')}</TableCell>
                    <TableCell align="right">{t('duration')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(legacyReport.stages ?? []).map((s) => (
                    <TableRow key={s.stage}>
                      <TableCell>{s.stage}</TableCell>
                      <TableCell align="right">{s.rows_in.toLocaleString()}</TableCell>
                      <TableCell align="right">{s.rows_out.toLocaleString()}</TableCell>
                      <TableCell align="right">{s.skipped.toLocaleString()}</TableCell>
                      <TableCell align="right">{s.duration}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {legacyReport.reconcile?.checks && (
                <Alert severity={legacyReport.reconcile.checks.every((c) => c.ok) ? 'success' : 'warning'}>
                  {t('reconcile', {
                    ok: legacyReport.reconcile.checks.filter((c) => c.ok).length,
                    total: legacyReport.reconcile.checks.length,
                  })}
                </Alert>
              )}
              {legacyReport.failed && <Alert severity="error">{legacyReport.failed}</Alert>}
            </Stack>
          )}
        </Stack>
      </GlassCard>

      {/* ---------------- confirmations ---------------- */}
      <GlassDialog
        open={Boolean(confirmRestore)}
        onClose={() => {
          setConfirmRestore(null);
          setUnderstood(false);
        }}
        title={t('confirmRestoreTitle')}
        actions={
          <>
            <GlassButton
              variant="outlined"
              onClick={() => {
                setConfirmRestore(null);
                setUnderstood(false);
              }}
            >
              {tc('cancel')}
            </GlassButton>
            <GlassButton color="error" disabled={!understood} loading={restore.isPending} onClick={startRestore} data-testid="restore-confirm">
              {t('restoreNow')}
            </GlassButton>
          </>
        }
      >
        <Stack spacing={2}>
          <Alert severity="error">{replace ? t('confirmRestoreReplace') : t('confirmRestoreMerge')}</Alert>
          <Typography variant="body2">{confirmRestore?.name ?? confirmRestore?.file?.name}</Typography>
          <FormControlLabel
            control={<Checkbox checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="restore-understood" />}
            label={t('understood')}
          />
        </Stack>
      </GlassDialog>

      <GlassDialog
        open={confirmImport}
        onClose={() => setConfirmImport(false)}
        title={t('confirmImportTitle')}
        actions={
          <>
            <GlassButton variant="outlined" onClick={() => setConfirmImport(false)}>
              {tc('cancel')}
            </GlassButton>
            <GlassButton
              onClick={() => {
                setConfirmImport(false);
                runImport.mutate(false, { onSuccess: () => toast.success(t('importStarted')), onError: (e) => toast.error(errorMessage(e)) });
              }}
              data-testid="legacy-import-confirm"
            >
              {t('runImport')}
            </GlassButton>
          </>
        }
      >
        <Alert severity="info">{t('confirmImportBody')}</Alert>
      </GlassDialog>
    </Stack>
  );
}

export default function DataPage() {
  return (
    <RequireAuth roles={['store_owner']}>
      <DataContent />
    </RequireAuth>
  );
}
