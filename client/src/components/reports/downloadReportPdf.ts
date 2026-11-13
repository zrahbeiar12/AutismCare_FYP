import { reportAPI } from '../../api';

/** Save a PDF response (axios, responseType blob) using the file name the server sends. */
export function savePdfResponse(res: { data: unknown; headers?: Record<string, unknown> }, fallbackName: string): void {
  const header = String(res.headers?.['content-disposition'] || '');
  const match = /filename="?([^";]+)"?/i.exec(header);
  const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download a report PDF. Every role (parent, clinician, therapist) uses this, so the file and its name are
 * the same whoever downloads it.
 */
export async function downloadReportPdf(reportId: string): Promise<void> {
  const res = await reportAPI.downloadPdf(reportId);
  savePdfResponse(res, `AutismCare_report_${reportId}.pdf`);
}
