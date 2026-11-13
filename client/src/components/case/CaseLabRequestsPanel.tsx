import { Badge } from '../ui/badge';
import { ProtectedLink } from '../ui/ProtectedMedia';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { FlaskConical, Download } from 'lucide-react';

type LabReportRow = {
  _id: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  uploadedAt?: string;
  labTechnician?: { firstName?: string; lastName?: string } | null;
};

export type CaseLabRequestRow = {
  _id: string;
  testType?: string;
  test_name?: string;
  status: string;
  notes?: string;
  releasedToParent?: boolean;
  childName?: string;
  createdAt?: string;
  reports?: LabReportRow[];
};

function resolveUploadUrl(filePath: string) {
  if (!filePath) return '';
  if (filePath.startsWith('http')) return filePath;
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

function formatDate(iso: string | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-muted text-foreground border-border',
  UPLOADED: 'bg-secondary text-primary border-border',
  RELEASED: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-900 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-900 border-emerald-200',
};

function statusBadgeClass(status: string) {
  return STATUS_BADGE[status] || 'bg-muted text-foreground border-border';
}

interface CaseLabRequestsPanelProps {
  requests: CaseLabRequestRow[];
  /** Clinician view includes technician names on files. */
  showLabTechnician?: boolean;
}

export function CaseLabRequestsPanel({ requests, showLabTechnician }: CaseLabRequestsPanelProps) {
  const list = Array.isArray(requests) ? requests : [];

  if (list.length === 0) {
    return (
      <Card className="border shadow-sm bg-card">
        <CardHeader className="border-b border bg-blue-50/50">
          <CardTitle className="text-base flex items-center gap-2 text-blue-900">
            <FlaskConical className="h-5 w-5" />
            Lab tests
          </CardTitle>
          <CardDescription>Orders and reports tied to this child case</CardDescription>
        </CardHeader>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground text-center">
            No lab test requests yet. Your clinician can order tests from the Lab Reports workflow.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border shadow-sm bg-card">
      <CardHeader className="border-b border bg-blue-50/50">
        <CardTitle className="text-base flex items-center gap-2 text-blue-900">
          <FlaskConical className="h-5 w-5" />
          Lab tests
        </CardTitle>
        <CardDescription>Orders and reports for this case (newest first)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {list.map((req) => (
          <div key={String(req._id)} className="rounded-lg border bg-background/40 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border pb-2">
              <div>
                <p className="font-semibold text-foreground">{req.testType || req.test_name || 'Lab test'}</p>
                <p className="text-xs text-muted-foreground">{formatDate(req.createdAt)}</p>
              </div>
              <Badge variant="outline" className={statusBadgeClass(req.status)}>
                {req.status}
              </Badge>
            </div>
            {req.notes ? (
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Notes: </span>
                {req.notes}
              </p>
            ) : null}
            {!showLabTechnician && req.status === 'RELEASED' && !req.releasedToParent ? (
              <p className="mt-2 text-xs text-amber-800">
                Report uploaded — your clinician is reviewing before release to the family app.
              </p>
            ) : null}
            {!showLabTechnician && req.status === 'PENDING' ? (
              <p className="mt-2 text-xs text-muted-foreground">Waiting for the lab to upload results.</p>
            ) : null}
            {!showLabTechnician && req.status === 'IN_PROGRESS' ? (
              <p className="mt-2 text-xs text-muted-foreground">Lab has accepted this request and is processing it.</p>
            ) : null}
            {!showLabTechnician && req.status === 'UPLOADED' ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Results uploaded — pending clinician review and release.
              </p>
            ) : null}
            {!showLabTechnician && req.status === 'COMPLETED' ? (
              <p className="mt-2 text-xs text-muted-foreground">Lab completed this request and uploaded report.</p>
            ) : null}
            {Array.isArray(req.reports) && req.reports.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {req.reports.map((rep) => (
                  <li
                    key={String(rep._id)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-foreground">{rep.fileName || 'Report file'}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(rep.uploadedAt)}</p>
                      {showLabTechnician && rep.labTechnician ? (
                        <p className="text-xs text-muted-foreground">
                          Lab tech: {rep.labTechnician.firstName} {rep.labTechnician.lastName}
                        </p>
                      ) : null}
                    </div>
                    {rep.fileUrl ? (
                      <ProtectedLink
                        href={resolveUploadUrl(rep.fileUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <Download className="h-4 w-4" />
                        Open
                      </ProtectedLink>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : req.releasedToParent && req.status === 'RELEASED' ? (
              <p className="mt-2 text-xs text-muted-foreground">No report files on record.</p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
