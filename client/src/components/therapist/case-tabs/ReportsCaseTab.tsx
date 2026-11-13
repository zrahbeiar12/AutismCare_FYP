import React, { useCallback, useEffect, useState } from 'react';
import { reportAPI } from '../../../api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Separator } from '../../ui/separator';
import { Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { ReportDocumentView } from '../../reports/ReportDocumentView';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { cn } from '../../ui/utils';
import { messageFromAxiosBlobError } from '../../../utils/blobApiError';
import { toast } from 'sonner';
import { downloadReportPdf } from '../../reports/downloadReportPdf';

const REPORT_OPTIONS = [
  { value: 'monthly', label: 'Monthly therapy report' },
  { value: 'iep', label: 'IEP summary' },
  { value: 'clinician', label: 'Clinician report' },
  { value: 'parent', label: 'Parent-friendly report' },
  { value: 'integrated', label: 'Integrated report (progress engine)' },
] as const;

type ReportRow = {
  id: string;
  type: string;
  generatedAt: string;
  insufficientData?: boolean;
};

function reportTypeLabel(type: string) {
  const t = String(type || '').toLowerCase();
  const map: Record<string, string> = {
    monthly: 'Monthly',
    iep: 'IEP',
    clinician: 'Clinician',
    parent: 'Parent',
    progress: 'Progress',
    session: 'Session',
    therapy: 'Therapy',
    integrated: 'Integrated',
  };
  return map[t] || type || 'Report';
}

function reportTypeBadgeClass(type: string) {
  const t = String(type || '').toLowerCase();
  if (t === 'integrated') return 'border-violet-200 bg-violet-50 text-violet-900';
  if (t === 'clinician') return 'border-sky-200 bg-sky-50 text-sky-900';
  if (t === 'parent') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

type ReportsCaseTabProps = {
  caseId: string;
  /** From case file — used to disable generate when backend would reject. */
  sessionsCount?: number;
  therapyCaseStatus?: string;
};

export function ReportsCaseTab({
  caseId,
  sessionsCount = 0,
  therapyCaseStatus = '',
}: ReportsCaseTabProps) {
  const therapyUpper = String(therapyCaseStatus || '').toUpperCase();
  const canGenerateReports =
    (therapyUpper === 'ACTIVE' || therapyUpper === 'COMPLETED') && sessionsCount > 0;

  const [list, setList] = useState<ReportRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ type: string; data: Record<string, unknown> } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const loadList = useCallback(async () => {
    if (!caseId) return;
    setLoadingList(true);
    setError(null);
    try {
      const res = await reportAPI.listByCase(caseId);
      const rows = (res.data?.data || []) as ReportRow[];
      setList(rows);
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

  const generate = async (type: string) => {
    setGenerating(type);
    setError(null);
    try {
      const res =
        type === 'integrated'
          ? await reportAPI.generateByCaseId(caseId)
          : await reportAPI.generate({ caseId, type });
      const body = res.data?.data;
      const id = body?.reportId;
      await loadList();
      if (id) {
        await loadDetail(String(id));
      }
      toast.success('Report generated');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      const msg = err.response?.data?.message || 'Failed to generate report';
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(null);
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
    <div className="space-y-4">
      <Card className="overflow-hidden border border-slate-200/90 bg-card shadow-md">
        <CardHeader className="space-y-1 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-violet-50/30 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
              <FileText className="h-5 w-5 text-violet-700" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">Clinical reports</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-relaxed text-slate-600">
                Auto-generated from this case&apos;s therapy plan, sessions, home assignments, and analytics. Documents
                are read-only and suitable for records or sharing with the care team.
              </CardDescription>
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

          {!canGenerateReports ? (
            <p className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
              Reports are available when therapy is active or completed and at least one session exists.
            </p>
          ) : null}

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Generate</p>
            <div className="flex flex-wrap gap-2">
              {REPORT_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
                  disabled={!canGenerateReports || !!generating}
                  onClick={() => generate(opt.value)}
                >
                  {generating === opt.value ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <Separator className="bg-slate-200" />

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

          <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
            <div className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4 lg:col-span-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Generated reports</p>
              {loadingList ? (
                <div className="flex items-center gap-2 py-10 text-sm text-slate-600">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-violet-600" aria-hidden />
                  Loading…
                </div>
              ) : list.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-600">
                  None yet — use the actions above to create your first report.
                </p>
              ) : (
                <Select
                  value={selectedId || undefined}
                  onValueChange={(v) => {
                    void loadDetail(v);
                  }}
                >
                  <SelectTrigger className="h-11 border-slate-200 bg-white text-left shadow-sm">
                    <SelectValue placeholder="Select a report" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {list.map((r) => (
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
                              <span className="ml-2 text-xs text-amber-700">· Partial</span>
                            ) : null}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="min-h-[140px] rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm lg:col-span-7">
              {loadingDetail ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-slate-600">
                  <Loader2 className="h-9 w-9 animate-spin text-violet-600" aria-hidden />
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
                      {String(detail.data?.generatedAt || '')}
                    </p>
                  </div>
                  <div className="max-h-[min(70vh,560px)] overflow-y-auto pr-1">
                    <ReportDocumentView reportType={detail.type} payload={detail.data} />
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[220px] flex-col items-center justify-center text-center text-sm text-slate-500">
                  Select a report to preview. Generated documents appear in the list on the left.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
