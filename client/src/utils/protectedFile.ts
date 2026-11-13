import API from '../api';
import { resolveUploadsHref } from './resolveUploadsUrl';

/**
 * Uploaded files are served only to signed-in users who may see them, so a plain <a href>/<img src> can't load
 * them (the login token travels in a header, not a cookie). These helpers fetch the file with the token and hand
 * back a temporary blob: URL.
 */
export async function fetchProtectedBlobUrl(url: string): Promise<string> {
  const abs = /^(blob:|data:)/i.test(url) ? url : resolveUploadsHref(url);
  if (/^(blob:|data:)/i.test(abs)) return abs;
  const res = await API.get(abs, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

/** Open a protected file in a new tab (PDFs and images display; other types download). */
export async function openProtectedFile(url: string): Promise<void> {
  // Open the tab synchronously so pop-up blockers allow it, then point it at the file once loaded.
  const win = window.open('', '_blank');
  try {
    const blobUrl = await fetchProtectedBlobUrl(url);
    if (win) win.location.href = blobUrl;
    else window.location.assign(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}
