import React, { useState } from 'react';
import { Eye, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../ui/utils';
import { downloadReportPdf } from './downloadReportPdf';
import { messageFromAxiosBlobError } from '../../utils/blobApiError';
import type { ReportListRow } from './reportLabels';
import { reportCardSummary, reportTypeLabel } from './reportLabels';

function truncate(text: string, max = 140) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

export function ReportCard({
  row,
  onView,
  className,
}: {
  row: ReportListRow;
  onView: () => void;
  className?: string;
}) {
  const summary = reportCardSummary(row);
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadReportPdf(String(row.id));
      toast.success('PDF downloaded');
    } catch (e: unknown) {
      toast.error(await messageFromAxiosBlobError(e));
    } finally {
      setDownloading(false);
    }
  };
  const dateStr = row.generatedAt ? new Date(row.generatedAt).toLocaleString() : '—';

  return (
    <article
      className={cn(
        'group flex flex-col gap-4 rounded-2xl border/90 bg-card p-5 shadow-sm transition-all duration-200',
        'hover:border-blue-200 hover:shadow-md',
        className
      )}
    >
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">{row.childName || 'Child'}</h3>
            <Badge
              variant="outline"
              className="border-blue-200 bg-blue-50/80 font-medium text-blue-900"
            >
              {reportTypeLabel(row.type)}
            </Badge>
            {row.insufficientData ? (
              <Badge
                variant="outline"
                className="border-yellow-200 bg-yellow-50 font-medium text-yellow-900"
              >
                Partial data
              </Badge>
            ) : null}
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Generated {dateStr}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{truncate(summary)}</p>
        </div>

        <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:items-end lg:flex-row lg:items-center">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-blue-200 bg-card text-blue-900 hover:bg-blue-50"
            onClick={onView}
          >
            <Eye className="mr-1.5 h-4 w-4" />
            View
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border"
            disabled={downloading}
            onClick={() => void download()}
          >
            {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Download PDF
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ReportCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <div className="flex-1 space-y-3">
          <div className="h-5 w-40 rounded-md bg-muted" />
          <div className="h-3 w-28 rounded bg-muted" />
          <div className="h-4 w-full max-w-md rounded bg-muted" />
          <div className="h-4 w-full max-w-sm rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-20 rounded-md bg-muted" />
          <div className="h-9 w-24 rounded-md bg-muted" />
        </div>
      </div>
    </div>
  );
}
