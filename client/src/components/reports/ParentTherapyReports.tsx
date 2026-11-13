import React, { useCallback, useEffect, useState } from 'react';
import { parentAPI, reportAPI } from '../../api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Loader2, RefreshCw, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadReportPdf } from './downloadReportPdf';
import { messageFromAxiosBlobError } from '../../utils/blobApiError';
import { ReportDocumentView } from './ReportDocumentView';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../ui/utils';

type CaseRow = { caseId: string; childName: string };
type ReportRow = { id: string; type: string; generatedAt: string };

export function ParentTherapyReports() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [caseId, setCaseId] = useState<string>('');
  const [list, setList] = useState<ReportRow[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ type: string; data: Record<string, unknown> } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const downloadPdf = async () => {
    if (!selectedId) return;
    setDownloadingPdf(true);
    try {
      await downloadReportPdf(selectedId);
      toast.success('PDF downloaded');
    } catch (e: unknown) {
      toast.error(await messageFromAxiosBlobError(e));
    } finally {
      setDownloadingPdf(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCases(true);
      try {
        const res = await parentAPI.getCases();
        const rows = (res.data?.data || []) as CaseRow[];
        if (!cancelled) {
          setCases(rows);
          if (rows.length && !caseId) setCaseId(String(rows[0].caseId));
        }
      } catch {
        if (!cancelled) setCases([]);
      } finally {
        if (!cancelled) setLoadingCases(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadList = useCallback(async () => {
    if (!caseId) return;
    setLoadingList(true);
    setError(null);
    try {
      const res = await reportAPI.listByCase(caseId);
      const onlyParent = ((res.data?.data || []) as ReportRow[]).filter((r) => r.type === 'parent');
      setList(onlyParent);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to load reports');
      setList([]);
    } finally {
      setLoadingList(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (caseId) void loadList();
  }, [caseId, loadList]);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await reportAPI.getById(id);
      const d = res.data?.data;
      setDetail({
        type: d?.type || 'parent',
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Therapy reports</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Parent-friendly summaries your therapist generated. Read-only.
        </p>
      </div>

      <Card className="border bg-card shadow-sm">
        <CardHeader className="border-b border bg-blue-50/50">
          <CardTitle className="flex items-center gap-2 text-base text-blue-900">
            <FileText className="h-5 w-5 text-blue-600" />
            Your child&apos;s report
          </CardTitle>
          <CardDescription>Select a child case, then open a parent report.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {error ? (
            <div className="rounded-lg border bg-muted px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          {loadingCases ? (
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          ) : cases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No child cases linked to your account.</p>
          ) : (
            <div className="max-w-md">
              <label className="text-sm font-medium text-foreground">Child case</label>
              <Select value={caseId} onValueChange={(v) => setCaseId(v)}>
                <SelectTrigger className="mt-1 bg-card">
                  <SelectValue placeholder="Choose case" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((c) => (
                    <SelectItem key={String(c.caseId)} value={String(c.caseId)}>
                      {c.childName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadList()} disabled={loadingList || !caseId}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loadingList && 'animate-spin')} />
              Refresh list
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={!selectedId || downloadingPdf}>
              {downloadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download PDF
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <div>
              {loadingList ? (
                <p className="text-sm text-muted-foreground">Loading reports…</p>
              ) : list.length === 0 ? (
                <p className="text-sm text-muted-foreground">No parent reports yet for this case.</p>
              ) : (
                <Select
                  value={selectedId || undefined}
                  onValueChange={(v) => {
                    void loadDetail(v);
                  }}
                >
                  <SelectTrigger className="bg-card">
                    <SelectValue placeholder="Select a report" />
                  </SelectTrigger>
                  <SelectContent>
                    {list.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {new Date(r.generatedAt).toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="min-h-[200px] rounded-lg border bg-card p-3 shadow-sm">
              {loadingDetail ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
              ) : detail ? (
                <ReportDocumentView reportType="parent" payload={detail.data} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">Select a report to read.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
