import { useEffect, useState, useCallback } from 'react';
import { caseAPI } from '../../api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Loader2, RefreshCw, UserCircle2 } from 'lucide-react';
import { CaseStatusBadge } from '../CaseStatusBadge';

export interface ChildCaseListProps {
  onOpenCase: (caseId: string) => void;
}

const RISK_ALL = 'all';
const STATUS_ALL = 'all';

/* `risk-*` colours live in styles/theme-fixes.css (the frozen Tailwind snapshot lacks most of these utilities). */
const riskBadgeClass: Record<string, string> = {
  low: 'risk-low font-medium',
  medium: 'risk-medium font-medium',
  high: 'risk-high font-medium',
  unknown: 'risk-unknown font-medium',
};

const RISK_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Unknown' };

type AsqZone = 'ok' | 'monitor' | 'refer' | 'incomplete' | 'unknown';

type AsqDomain = {
  domain: string;
  score: number | null;
  maxScore: number;
  referralCutoff: number | null;
  monitorCutoff: number | null;
  status: string | null;
  zone: AsqZone;
};

type MchatResult = {
  totalScore: number | null;
  maxScore: number;
  result: string | null;
  riskLevel: string;
  completedAt?: string;
  clinicianDecision?: string | null;
};

type AsqResult = {
  intervalMonths: number | null;
  result: string | null;
  riskLevel: string;
  completedAt?: string;
  domains: AsqDomain[];
};

type Row = {
  _id: string;
  childId: string;
  childName: string;
  fileNumber?: string | null;
  mrNumber?: string | null;
  child?: { dateOfBirth: string | null; ageMonths: number | null; gender: string | null } | null;
  parentName: string;
  parentEmail: string | null;
  riskLevel: string;
  screenings?: { mchat: MchatResult | null; asq3: AsqResult | null };
  status: string;
  updatedAt: string;
};

const STATUS_OPTIONS = [
  'NEW',
  'SCREENING',
  'REVIEW',
  'DIAGNOSIS',
  'DIAGNOSIS_READY',
  'THERAPY',
  'THERAPY_ACTIVE',
  'MONITORING',
];

/** ASQ-3 domains in questionnaire order, with the short label used on the chips. */
const ASQ_DOMAINS: Array<{ domain: string; short: string }> = [
  { domain: 'Communication', short: 'Comm' },
  { domain: 'Gross Motor', short: 'GM' },
  { domain: 'Fine Motor', short: 'FM' },
  { domain: 'Problem Solving', short: 'PS' },
  { domain: 'Personal-Social', short: 'P-S' },
];

export function formatAge(ageMonths: number | null | undefined): string | null {
  if (typeof ageMonths !== 'number' || !Number.isFinite(ageMonths) || ageMonths < 0) return null;
  const y = Math.floor(ageMonths / 12);
  const m = ageMonths % 12;
  if (y === 0) return `${m} m`;
  return m === 0 ? `${y} y` : `${y} y ${m} m`;
}

function childDetails(child: Row['child']): string | null {
  if (!child) return null;
  const parts = [
    formatAge(child.ageMonths),
    child.gender ? child.gender.charAt(0).toUpperCase() + child.gender.slice(1) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function domainTooltip(d: AsqDomain): string {
  const score = typeof d.score === 'number' ? `${d.score}/${d.maxScore}` : 'not answered';
  const cutoff = typeof d.referralCutoff === 'number' ? d.referralCutoff : null;
  let note: string;
  switch (d.zone) {
    case 'refer':
      note = cutoff != null ? `below referral cutoff ${cutoff}` : 'below referral cutoff';
      break;
    case 'monitor':
      note = 'monitoring zone';
      break;
    case 'ok':
      note = 'typical development';
      break;
    case 'incomplete':
      note = 'incomplete';
      break;
    default:
      note = 'no cutoff for this interval';
  }
  return `${d.domain} ${score} — ${note}`;
}

function MchatSummary({ mchat }: { mchat: MchatResult | null | undefined }) {
  if (!mchat) return <div className="text-xs text-muted-foreground">M-CHAT-R not done</div>;
  const score = typeof mchat.totalScore === 'number' ? `${mchat.totalScore}/${mchat.maxScore}` : '—';
  const risk = mchat.riskLevel in RISK_LABEL ? mchat.riskLevel : 'unknown';
  return (
    <Badge
      variant="outline"
      className={riskBadgeClass[risk]}
      title={`M-CHAT-R score ${score}${mchat.result ? ` (${mchat.result})` : ''}`}
    >
      M-CHAT-R {score} · {RISK_LABEL[risk]}
    </Badge>
  );
}

function AsqSummary({ asq3 }: { asq3: AsqResult | null | undefined }) {
  if (!asq3) return <div className="text-xs text-muted-foreground">ASQ-3 not done</div>;
  const byName = new Map(asq3.domains.map((d) => [d.domain, d]));
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-foreground">
        ASQ-3{typeof asq3.intervalMonths === 'number' ? ` (${asq3.intervalMonths} mo)` : ''}
        {asq3.result ? <span className="text-muted-foreground"> · {asq3.result}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1" aria-label="ASQ-3 domain results">
        {ASQ_DOMAINS.map(({ domain, short }) => {
          const d = byName.get(domain);
          const zone: AsqZone = d?.zone || 'incomplete';
          const score = d && typeof d.score === 'number' ? d.score : '—';
          return (
            <span
              key={domain}
              className={`zone-chip zone-${zone}`}
              title={d ? domainTooltip(d) : `${domain} — not answered`}
              data-zone={zone}
            >
              {short} {score}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function ChildCaseList({ onOpenCase }: ChildCaseListProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<string>(RISK_ALL);
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_ALL);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (riskFilter !== RISK_ALL) params.riskLevel = riskFilter;
      if (statusFilter !== STATUS_ALL) params.status = statusFilter;
      const { data } = await caseAPI.list(params);
      setRows(data.data || []);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load child cases');
    } finally {
      setLoading(false);
    }
  }, [riskFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
  <h2 className="text-2xl font-semibold text-primary tracking-tight">Child Cases</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Centralized cases linked to approved appointments, screening results, and care status.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <Card className="border shadow-sm bg-card">
        <CardHeader className="pb-4 border-b border">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between">
            <div>
              <CardTitle className="text-lg text-foreground">Caseload</CardTitle>
              <CardDescription>Filter by risk level and case status</CardDescription>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="w-[160px]">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Risk level</label>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger className="bg-card border">
                    <SelectValue placeholder="Risk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RISK_ALL}>All risks</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[200px]">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="bg-card border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STATUS_ALL}>All statuses</SelectItem>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {error && (
            <div className="mb-4 rounded-lg border bg-muted px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground border-dashed border rounded-lg bg-background/50">
              <UserCircle2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium text-foreground">No cases match your filters</p>
              <p className="text-sm mt-1">Cases are created when you approve a diagnostic appointment for a child.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-background hover:bg-background">
                    <TableHead className="font-semibold text-foreground">Child</TableHead>
                    <TableHead className="font-semibold text-foreground">Parent / Guardian</TableHead>
                    <TableHead className="font-semibold text-foreground">Screening results</TableHead>
                    <TableHead className="font-semibold text-foreground">Risk</TableHead>
                    <TableHead className="font-semibold text-foreground">Status</TableHead>
                    <TableHead className="font-semibold text-foreground">Last updated</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const details = childDetails(row.child);
                    const risk = row.riskLevel in RISK_LABEL ? row.riskLevel : 'unknown';
                    return (
                    <TableRow key={row._id} className="hover:bg-blue-50/40 align-top">
                      <TableCell>
                        <div className="font-medium text-foreground">{row.childName}</div>
                        {details && <div className="text-xs text-muted-foreground">{details}</div>}
                        {row.fileNumber || row.mrNumber ? (
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {row.fileNumber || ''}
                            {row.mrNumber ? `${row.fileNumber ? ' · ' : ''}MR ${row.mrNumber}` : ''}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="text-foreground">{row.parentName}</div>
                        {row.parentEmail && (
                          <div className="text-xs text-muted-foreground">{row.parentEmail}</div>
                        )}
                      </TableCell>
                      <TableCell style={{ minWidth: 220 }}>
                        <div className="space-y-2">
                          <MchatSummary mchat={row.screenings?.mchat} />
                          <AsqSummary asq3={row.screenings?.asq3} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={riskBadgeClass[risk]}>
                          {RISK_LABEL[risk]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <CaseStatusBadge status={row.status} showMeaning={false} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(row.updatedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          className="btn-accent"
                          onClick={() => onOpenCase(row._id)}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
