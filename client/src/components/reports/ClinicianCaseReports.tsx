import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { reportAPI } from '../../api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Loader2, RefreshCw, FileText, Download } from 'lucide-react';
import { ReportDocumentView } from './ReportDocumentView';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../ui/utils';
import { messageFromAxiosBlobError } from '../../utils/blobApiError';
import { toast } from 'sonner';
import { downloadReportPdf } from './downloadReportPdf';

type ReportRow = { id: string; type: string; generatedAt: string; insufficientData?: boolean };

function reportTypeLabel(type: string) {
  const t = String(type || '').toLowerCase();
  if (t === 'integrated') return 'Integrated';
  if (t === 'clinician') return 'Clinician';
  return type || 'Report';
}

function reportTypeBadgeClass(type: string) {
  const t = String(type || '').toLowerCase();
  if (t === 'integrated') return 'border-violet-200 bg-violet-50 text-violet-900';
  if (t === 'clinician') return 'border-sky-200 bg-sky-50 text-sky-900';
  return 'border-border bg-muted text-foreground';
}

/** Clinician read-only: therapist-generated clinician and integrated (progress engine) reports. */
export function ClinicianCaseReports({ caseId }: { caseId: string }) {
  const [list, setList] = useState<ReportRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ type: string; data: Record<string, unknown> } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const visibleReports = useMemo(
    () => list.filter((r) => r.type === 'clinician' || r.type === 'integrated'),
    [list]
  );

  const loadList = useCallback(async () => {
    if (!caseId) return;
    setLoadingList(true);
    setError(null);
    try {
      const res = await reportAPI.listByCase(caseId);
      setList((res.data?.data || []) as ReportRow[]);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to load reports');
      setList([]);
    } finally {
      setLoadingList(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await reportAPI.getById(id);
      const d = res.data?.data;
      setDetail({
        type: d?.type || '',
        data: (d?.data || {}) as Record<string, unknown>,
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to load report');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const downloadPdf = async () => {
    if (!selectedId) return;
    setDownloadingPdf(true);
    setError(null);
    try {
      await downloadReportPdf(selectedId);
      toast.success('PDF downloaded');
    } catch (e: unknown) {
      const msg = await messageFromAxiosBlobError(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <Card className="overflow-hidden border border-slate-200/90 bg-card shadow-md">
      <CardHeader className="space-y-1 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-sky-50/40 px-6 py-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
              <FileText className="h-5 w-5 text-sky-700" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">
                Case reports
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-relaxed text-slate-600">
                Read-only documents from the treating therapist — including integrated progress summaries for clinical
                oversight.
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 px-6 py-6">
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900"
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
            onClick={() => void loadList()}
            disabled={loadingList}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', loadingList && 'animate-spin')} aria-hidden />
            Refresh list
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="bg-slate-900 text-white hover:bg-slate-800"
            disabled={!selectedId || downloadingPdf}
            onClick={() => void downloadPdf()}
          >
            {downloadingPdf ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden />
            )}
            Download PDF
          </Button>
        </div>

        <Separator className="bg-slate-200" />

        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="space-y-3 lg:col-span-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Library</p>
            {loadingList ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-8 text-sm text-slate-600">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-600" aria-hidden />
                Loading reports…
              </div>
            ) : visibleReports.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-600">
                No clinician or integrated reports yet. Ask the therapist to generate them from the case file.
              </div>
            ) : (
              <Select
                value={selectedId || undefined}
                onValueChange={(v) => {
                  void loadDetail(v);
                }}
              >
                <SelectTrigger className="h-11 border-slate-200 bg-white text-left shadow-sm">
                  <SelectValue placeholder="Choose a report to preview" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {visibleReports.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="py-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <Badge variant="outline" className={cn('w-fit font-medium', reportTypeBadgeClass(r.type))}>
                          {reportTypeLabel(r.type)}
                        </Badge>
                        <span className="text-sm text-slate-700">
                          {new Date(r.generatedAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                          {r.insufficientData ? (
                            <span className="ml-2 text-xs text-amber-700">· Partial data</span>
                          ) : null}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="min-h-[220px] rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm lg:col-span-7">
            {loadingDetail ? (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-slate-600">
                <Loader2 className="h-9 w-9 animate-spin text-sky-600" aria-hidden />
                <p className="text-sm">Loading preview…</p>
              </div>
            ) : detail ? (
              <div className="print:print-friendly">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn('font-medium', reportTypeBadgeClass(detail.type))}>
                      {reportTypeLabel(detail.type)}
                    </Badge>
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Preview</span>
                  </div>
                  <p className="text-xs text-slate-500 tabular-nums">
                    Generated {String(detail.data?.generatedAt || '')}
                  </p>
                </div>
                <div className="max-h-[min(70vh,560px)] overflow-y-auto pr-1">
                  <ReportDocumentView reportType={detail.type} payload={detail.data} />
                </div>
              </div>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center text-center text-sm text-slate-500">
                Select a report from the library to preview its contents here.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
