import { api } from './client';

/**
 * Fetches `path` with the auth headers (the browser cannot attach them to a
 * plain link) and hands the blob to the user as a download.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await api.get<Blob>(path, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
