'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** Backup / restore / legacy-import jobs run in the background; the UI polls them. */
export interface DataJob {
  id: string;
  store_id: string;
  kind: 'backup' | 'restore' | 'legacy_import';
  status: 'running' | 'done' | 'error';
  step?: string;
  progress?: number;
  error?: string;
  file?: string;
  report?: unknown;
  started_at: string;
  finished_at?: string;
  actor_name?: string;
}

export interface BackupFile {
  name: string;
  size: number;
  created_at: string;
}

export interface LegacyDump {
  uploaded_at: string;
  source_sha256: string;
  tables: Record<string, number>;
  file_name: string;
  size_bytes: number;
}

export interface BackupMeta {
  version: number;
  created_at: string;
  store_code: string;
  store_name: string;
  counts: Record<string, number>;
}

export interface RestoreReport {
  archive: string;
  meta?: BackupMeta;
  replaced: boolean;
  deleted?: Record<string, number>;
  inserted: Record<string, number>;
  warnings?: string[];
}

/** One stage of the legacy importer (see internal/legacy). */
export interface LegacyStage {
  stage: string;
  rows_in: number;
  rows_out: number;
  skipped: number;
  warnings?: string[];
  duration: string;
}

export interface LegacyReport {
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  stages: LegacyStage[];
  failed?: string;
  reconcile?: { checks?: Array<{ name: string; ok: boolean; expected?: unknown; actual?: unknown }> };
}

export const dataKeys = {
  jobs: ['data-ops', 'jobs'] as const,
  backups: ['data-ops', 'backups'] as const,
  legacy: ['data-ops', 'legacy'] as const,
};

/** Polls while any job is running so progress moves without the user reloading. */
export function useDataJobs() {
  return useQuery({
    queryKey: dataKeys.jobs,
    queryFn: () => api.get<DataJob[]>('/store/data/jobs'),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'running') ? 2000 : false),
  });
}

export function useBackups() {
  return useQuery({ queryKey: dataKeys.backups, queryFn: () => api.get<BackupFile[]>('/store/data/backups') });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DataJob>('/store/data/backups'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dataKeys.jobs });
      void qc.invalidateQueries({ queryKey: dataKeys.backups });
    },
  });
}

export function useDeleteBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.delete<void>(`/store/data/backups/${encodeURIComponent(name)}`, undefined, { responseType: 'void' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataKeys.backups }),
  });
}

export interface RestoreInput {
  /** A backup kept on the server… */
  name?: string;
  /** …or a file the owner uploads from their own computer. */
  file?: File;
  replace: boolean;
  profile: boolean;
}

export function useRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RestoreInput) => {
      if (input.file) {
        const fd = new FormData();
        fd.append('file', input.file);
        fd.append('file_name', input.file.name);
        fd.append('replace', String(input.replace));
        fd.append('profile', String(input.profile));
        return api.post<DataJob>('/store/data/restore', fd);
      }
      return api.post<DataJob>('/store/data/restore', { name: input.name, replace: input.replace, profile: input.profile });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dataKeys.jobs }),
  });
}

export function useLegacyDump() {
  return useQuery({ queryKey: dataKeys.legacy, queryFn: () => api.get<LegacyDump | null>('/store/data/legacy') });
}

export function useUploadLegacyDump() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('file_name', file.name);
      return api.post<LegacyDump>('/store/data/legacy/upload', fd);
    },
    onSuccess: (dump) => qc.setQueryData(dataKeys.legacy, dump),
  });
}

export function useDiscardLegacyDump() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>('/store/data/legacy', undefined, { responseType: 'void' }),
    onSuccess: () => qc.setQueryData(dataKeys.legacy, null),
  });
}

export function useRunLegacyImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dryRun: boolean) => api.post<DataJob>('/store/data/legacy/import', { dry_run: dryRun }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataKeys.jobs }),
  });
}

/** Downloads a backup through the API (so the Authorization header is sent) and saves it. */
export async function downloadBackup(name: string): Promise<void> {
  const blob = await api.get<Blob>(`/store/data/backups/${encodeURIComponent(name)}`, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
