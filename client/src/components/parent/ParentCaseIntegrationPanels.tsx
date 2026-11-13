import { useCallback, useEffect, useState } from 'react';
import { ProtectedImage, ProtectedVideo } from '../ui/ProtectedMedia';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { BookOpen, Calendar, ClipboardList, History, Loader2, TrendingUp, FlaskConical, Target } from 'lucide-react';
import { Progress } from '../ui/progress';
import { integrationAPI, parentAPI, progressEngineAPI } from '../../api';
import { CaseMessagingThread } from '../messaging/CaseMessagingThread';
import { CaseLabRequestsPanel, type CaseLabRequestRow } from '../case/CaseLabRequestsPanel';
import { CaseStatusBadge } from '../CaseStatusBadge';
import { ClinicalAlertsPanel, LowConfidenceBanner } from '../progress-clinical';

type ParentCaseRow = {
  caseId: string;
  childId: string;
  childName?: string;
  status?: string;
  fileNumber?: string | null;
};

type SessionRow = {
  _id?: string;
  date: string;
  duration: number;
  childResponse: string;
  parentInstructions: string;
  status?: string;
};

type TherapistFeedback = {
  comment?: string | null;
  feedback?: string | null;
  rating?: number | null;
  reviewedAt?: string | null;
};

type ParentSubmission = {
  fileUrl?: string;
  submissionUrl?: string;
  fileType?: string;
  submittedAt?: string;
};

type AssignmentRow = {
  _id: string;
  activityName?: string;
  title?: string;
  dueDate: string;
  status: string;
  isLate?: boolean;
  instructions?: string;
  materials?: string;
  parentSubmission?: ParentSubmission;
  therapistFeedback?: TherapistFeedback;
  submissionUrl?: string;
};

type ParentEngineFriendly = {
  progressPercent?: number | null;
  trendLabel?: string;
  headline?: string;
  consistencyPercent?: number | null;
  homeProgramOnTrack?: boolean | null;
  message?: string;
  confidenceLabel?: string;
  interpretWithCaution?: boolean;
  domainScores?: Array<{ name: string; score: number; confidence?: number }>;
  goalsBrief?: Array<{
    goalId?: string;
    goalName?: string;
    trend?: string;
    current?: number | null;
    confidenceLabel?: string;
    limitedDataUi?: boolean;
  }>;
  alertsParent?: Array<{ severity?: string; message?: string; code?: string }>;
};

type SlotRow = {
  _id: string;
  date: string;
  time: string;
  duration: number;
  status: string;
};

type TherapyPlanShortGoal = {
  title?: string;
  measurableCriteria?: string;
  domain?: string;
  status?: string;
};

type TherapyPlanActivity = {
  title?: string;
  linkedGoal?: string;
  description?: string;
};

type TherapyPlanSummary = {
  domains?: string[];
  longTermGoal?: {
    title?: string;
    description?: string;
    timeline?: string;
  };
  shortTermGoals?: TherapyPlanShortGoal[];
  activities?: TherapyPlanActivity[];
  status?: string;
  approval?: { status?: string };
};

const SLOT_STATUS_BADGE: Record<string, string> = {
  scheduled: 'bg-muted text-foreground border',
  completed: 'bg-blue-50 text-blue-900 border-blue-200',
  missed: 'bg-muted text-destructive border',
  rescheduled: 'bg-yellow-50 text-yellow-900 border-yellow-200',
};

const ASSIGN_BADGE: Record<string, string> = {
  pending: 'bg-muted text-foreground',
  submitted: 'bg-blue-100 text-blue-900',
  reviewed: 'bg-yellow-100 text-yellow-900',
  completed: 'bg-blue-100 text-blue-950',
};

const GOAL_STATUS_BADGE: Record<string, string> = {
  active: 'bg-blue-100 text-blue-900',
  achieved: 'bg-emerald-100 text-emerald-900',
  modified: 'bg-violet-100 text-violet-900',
  onhold: 'bg-yellow-100 text-yellow-900',
  retired: 'bg-muted text-muted-foreground',
};

function formatDate(iso: string | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function resolveUploadUrl(filePath: string) {
  if (!filePath) return '';
  if (filePath.startsWith('http')) return filePath;
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

function assignmentDisplayName(a: AssignmentRow) {
  const n = (a.activityName || a.title || '').trim();
  return n || 'Home activity';
}

function hasTherapistFeedbackForParent(tf: TherapistFeedback | undefined) {
  if (!tf || typeof tf !== 'object') return false;
  const c = String(tf.comment || tf.feedback || '').trim();
  if (c) return true;
  if (tf.rating != null && tf.rating > 0) return true;
  if (tf.reviewedAt) return true;
  return false;
}

/** Pull scale 1–5 from therapist session log childResponse (e.g. "scale:4"). */
function extractResponseScale(cr: string | undefined): number | null {
  const m = String(cr || '').match(/scale:\s*(\d)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? n : null;
}

type PanelProps = {
  /** Initial / URL case (Child Case page). Selection can change when multiple children exist. */
  forcedCaseId?: string;
  /** Called when the parent picks another child — e.g. sync `/parent/case/:caseId`. */
  onCaseIdChange?: (caseId: string) => void;
};

export function ParentCaseIntegrationPanels({ forcedCaseId, onCaseIdChange }: PanelProps) {
  const [cases, setCases] = useState<ParentCaseRow[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [parentEngineView, setParentEngineView] = useState<ParentEngineFriendly | null>(null);
  const [sessionSlots, setSessionSlots] = useState<SlotRow[]>([]);
  const [labRequests, setLabRequests] = useState<CaseLabRequestRow[]>([]);
  const [therapyPlan, setTherapyPlan] = useState<TherapyPlanSummary | null>(null);
  const [loadingCases, setLoadingCases] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCases = useCallback(async () => {
    try {
      setLoadingCases(true);
      setError(null);
      const res = await parentAPI.getCases();
      const rows = (res.data?.data || []) as ParentCaseRow[];
      const normalized = rows.map((r) => ({
        ...r,
        caseId: String(r.caseId),
        childId: String(r.childId),
      }));
      setCases(normalized);
      setSelectedCaseId((prev) => {
        if (normalized.length === 0) return '';
        if (forcedCaseId && normalized.some((c) => c.caseId === forcedCaseId)) return forcedCaseId;
        if (prev && normalized.some((c) => c.caseId === prev)) return prev;
        return normalized[0].caseId;
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to load cases');
      setCases([]);
      setSelectedCaseId('');
    } finally {
      setLoadingCases(false);
    }
  }, [forcedCaseId]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  useEffect(() => {
    if (forcedCaseId && cases.some((c) => c.caseId === forcedCaseId)) {
      setSelectedCaseId(forcedCaseId);
    }
  }, [forcedCaseId, cases]);

  const handleChildCaseSelect = (value: string) => {
    setSelectedCaseId(value);
    onCaseIdChange?.(value);
  };

  useEffect(() => {
    if (!selectedCaseId) {
      setSessions([]);
      setAssignments([]);
      setParentEngineView(null);
      setSessionSlots([]);
      setLabRequests([]);
      setTherapyPlan(null);
      return;
    }

    const load = async () => {
      try {
        setLoadingDetail(true);
        setError(null);
        setLabRequests([]);
        const [sRes, aRes, slotRes, peRes, labRes, summaryRes] = await Promise.all([
          parentAPI.getCaseSessions(selectedCaseId),
          parentAPI.getCaseAssignments(selectedCaseId),
          parentAPI.getSessionSlots(selectedCaseId),
          progressEngineAPI.getByCase(selectedCaseId).catch(() => null),
          parentAPI.getCaseLabRequests(selectedCaseId).catch(() => ({ data: { data: [] } })),
          integrationAPI.getCaseSummary(selectedCaseId).catch(() => null),
        ]);
        setSessions(Array.isArray(sRes.data?.data) ? sRes.data.data : []);
        setAssignments(Array.isArray(aRes.data?.data) ? aRes.data.data : []);
        setLabRequests(Array.isArray(labRes.data?.data) ? (labRes.data.data as CaseLabRequestRow[]) : []);
        const ped = peRes?.data != null && typeof (peRes.data as { data?: unknown }).data === 'object'
          ? ((peRes.data as { data: ParentEngineFriendly }).data)
          : null;
        setParentEngineView(ped && typeof ped === 'object' && ped.headline ? ped : null);
        const plan =
          summaryRes?.data != null &&
          typeof (summaryRes.data as { data?: { therapyPlan?: unknown } }).data?.therapyPlan === 'object'
            ? ((summaryRes.data as { data: { therapyPlan: TherapyPlanSummary } }).data.therapyPlan)
            : null;
        setTherapyPlan(plan);
        const rawSlots = Array.isArray(slotRes.data?.data) ? slotRes.data.data : [];
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const upcoming = (rawSlots as SlotRow[])
          .filter((row) => {
            const d = new Date(row.date);
            return !Number.isNaN(d.getTime()) && d >= startOfToday;
          })
          .sort((a, b) => {
            const da = new Date(a.date).getTime();
            const db = new Date(b.date).getTime();
            if (da !== db) return da - db;
            return String(a.time).localeCompare(String(b.time));
          })
          .slice(0, 24);
        setSessionSlots(upcoming);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } };
        setError(err.response?.data?.message || 'Failed to load therapy data');
        setSessions([]);
        setAssignments([]);
        setParentEngineView(null);
        setSessionSlots([]);
        setLabRequests([]);
        setTherapyPlan(null);
      } finally {
        setLoadingDetail(false);
      }
    };

    void load();
  }, [selectedCaseId]);

  if (loadingCases) {
    return (
      <div className="max-w-6xl mx-auto space-y-4 p-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <Card className="mx-auto w-full max-w-5xl border-dashed border-blue-200 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-blue-950">Child case</CardTitle>
          <CardDescription>
            When your care team opens a case for your child, sessions, assignments, and progress will appear here.
            Add or manage children under <strong className="font-medium text-foreground">My Children</strong>.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const activeCase = cases.find((c) => c.caseId === selectedCaseId);
  const invalidForced = !!forcedCaseId && !cases.some((c) => c.caseId === forcedCaseId);

  if (invalidForced) {
    return (
      <Card className="mx-auto w-full max-w-5xl border-yellow-200 bg-yellow-50/50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-yellow-900">Case not found</CardTitle>
          <CardDescription>
            This case is not linked to your account, or the link may be outdated. Use <strong>Child Case</strong> from
            the menu to open your active case.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {forcedCaseId && cases.length > 1 ? (
        <Card className="border-blue-100 bg-card shadow-sm">
          <CardContent className="pt-6">
            <div className="max-w-md space-y-2">
              <Label htmlFor="child-case-select" className="text-foreground">
                Select Child
              </Label>
              <Select value={selectedCaseId} onValueChange={handleChildCaseSelect}>
                <SelectTrigger
                  id="child-case-select"
                  className="h-11 w-full border bg-card shadow-sm focus:ring-blue-500"
                >
                  <SelectValue placeholder="Select a child" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((c) => (
                    <SelectItem key={c.caseId} value={c.caseId}>
                      {c.childName || 'Child'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {forcedCaseId && cases.length === 1 ? (
        <div className="rounded-xl border-blue-100 bg-card px-4 py-3 shadow-sm">
          <p className="text-sm text-foreground">
            <span className="font-semibold text-blue-950">Child: </span>
            {cases[0].childName || 'Child'}
          </p>
        </div>
      ) : null}

      {forcedCaseId && activeCase ? (
        <Card className="border-blue-100 bg-card shadow-sm">
          <CardHeader className="border-b border pb-3">
            <CardTitle className="text-lg font-semibold text-blue-950">Child / case information</CardTitle>
            <CardDescription>Basic details for this therapy case.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Child</dt>
                <dd className="text-base font-medium text-foreground">{activeCase.childName || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Case status</dt>
                <dd className="pt-1">
                  <CaseStatusBadge status={activeCase.status || 'NEW'} />
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">File number</dt>
                <dd className="font-mono text-sm text-foreground">
                  {activeCase.fileNumber || 'Given when your clinician registers the case'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {selectedCaseId && !loadingDetail ? <CaseLabRequestsPanel requests={labRequests} /> : null}
      {selectedCaseId && loadingDetail ? (
        <Card className="border-blue-100 bg-card shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">Lab tests</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading lab activity…
            </div>
          </CardContent>
        </Card>
      ) : null}

      {selectedCaseId ? (
        <CaseMessagingThread caseId={selectedCaseId} childLabel={activeCase?.childName} />
      ) : null}

      {!forcedCaseId ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="max-w-md flex-1 space-y-2">
            <Label htmlFor="case-select">Child / case</Label>
            <Select value={selectedCaseId} onValueChange={setSelectedCaseId}>
              <SelectTrigger id="case-select" className="w-full border">
                <SelectValue placeholder="Select a child" />
              </SelectTrigger>
              <SelectContent>
                {cases.map((c) => (
                  <SelectItem key={c.caseId} value={c.caseId}>
                    {c.childName || 'Child'} · {String(c.caseId).slice(-6)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {error && (
        <p className="text-sm text-yellow-700 bg-yellow-50 border-yellow-200 rounded-md px-3 py-2" role="alert">
          {error}
        </p>
      )}

      {/* Upcoming therapy session slots (schedule — not booking) */}
      <Card className="border-blue-100 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">Upcoming sessions</CardTitle>
          </div>
          <CardDescription>
            Planned therapy times from your therapist&apos;s schedule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : sessionSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming scheduled sessions for this case.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border">
              {sessionSlots.map((row) => (
                <li key={row._id} className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-foreground">
                      {formatDate(row.date)} · {row.time}
                    </p>
                    <p className="text-xs text-muted-foreground">{row.duration} minutes</p>
                  </div>
                  <Badge variant="outline" className={SLOT_STATUS_BADGE[row.status] || SLOT_STATUS_BADGE.scheduled}>
                    {row.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Logged sessions — compact history (same API as Session guidance) */}
      <Card className="border-blue-100 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">Session history</CardTitle>
          </div>
          <CardDescription>
            Logged therapy sessions for this case (newest first). Response trend uses 1–5 scale when present in session
            notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session history…
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No logged sessions yet. Your therapist will record sessions here.</p>
          ) : (
            <>
              {(() => {
                const chronological = [...sessions].slice(0, 12).reverse();
                const scales = chronological
                  .map((s) => extractResponseScale(s.childResponse))
                  .filter((x): x is number => x != null)
                  .slice(-8);
                const trend =
                  scales.length >= 2 ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-blue-900">Response trend (1–5): </span>
                      {scales.join(' → ')}
                    </p>
                  ) : null;
                return trend;
              })()}
              <div className="grid gap-3">
                {sessions.map((s, idx) => (
                  <div
                    key={s._id ? String(s._id) : `hist-${idx}`}
                    className="rounded-lg border bg-background/40 p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border pb-2">
                      <p className="font-semibold text-blue-950">{formatDate(s.date)}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {s.duration != null ? <span>{s.duration} min</span> : null}
                        {s.status ? (
                          <Badge variant="outline" className="text-xs capitalize">
                            {s.status}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-foreground">
                      <span className="font-medium text-muted-foreground">Response: </span>
                      {s.childResponse?.trim() || '—'}
                    </p>
                    <p className="mt-2 line-clamp-3 text-sm text-foreground">
                      <span className="font-medium text-blue-800">Instructions: </span>
                      {s.parentInstructions?.trim() || '—'}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Session guidance */}
      <Card className="border-blue-100 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">Session guidance</CardTitle>
          </div>
          <CardDescription>
            Full detail for each session — including instructions for you between visits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions logged yet for this case.</p>
          ) : (
            <ul className="space-y-4">
              {sessions.map((s, idx) => (
                <li
                  key={s._id ? String(s._id) : `${s.date}-${idx}`}
                  className="rounded-lg border bg-card p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{formatDate(s.date)}</span>
                    {s.duration ? <span>· {s.duration} min</span> : null}
                    {s.status ? (
                      <Badge variant="outline" className="text-xs">
                        {s.status}
                      </Badge>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Child response</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{s.childResponse || '—'}</p>
                  </div>
                  <div className="rounded-md bg-blue-50 border-blue-100 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-800 mb-1">
                      Instructions for you
                    </p>
                    <p className="text-sm text-blue-950 whitespace-pre-wrap">
                      {s.parentInstructions?.trim() ? s.parentInstructions : '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Home assignments */}
      <Card className="border-blue-100 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-blue-700" />
            <CardTitle className="text-lg">Home assignments</CardTitle>
          </div>
          <CardDescription>Activities your therapist assigned for this case.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading assignments…
            </div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No home assignments for this case yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border">
              {assignments.map((a) => {
                const st = String(a.status || 'pending').toLowerCase();
                const ps = a.parentSubmission;
                const rawUrl = a.submissionUrl || ps?.submissionUrl || ps?.fileUrl || '';
                const fileAbs = rawUrl ? resolveUploadUrl(rawUrl) : '';
                const fb = a.therapistFeedback;
                const showFeedback = (st === 'reviewed' || st === 'completed') && hasTherapistFeedbackForParent(fb);
                const feedbackText = String(fb?.feedback || fb?.comment || '').trim();
                return (
                  <li key={a._id} className="space-y-3 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-foreground">{assignmentDisplayName(a)}</p>
                        <p className="text-xs text-muted-foreground">Due {formatDate(a.dueDate)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {a.isLate ? (
                          <Badge variant="outline" className="border text-foreground">
                            Late
                          </Badge>
                        ) : null}
                        <Badge className={ASSIGN_BADGE[st] || 'bg-muted'}>{a.status}</Badge>
                      </div>
                    </div>

                    {rawUrl && st !== 'pending' ? (
                      <div className="rounded-lg border bg-background/90 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parent submission</p>
                        {ps?.submittedAt ? (
                          <p className="text-xs text-muted-foreground">Submitted {formatDate(ps.submittedAt)}</p>
                        ) : null}
                        {ps?.fileType === 'image' ? (
                          <ProtectedImage
                            src={fileAbs}
                            alt=""
                            className="mt-2 max-h-40 rounded-md border object-contain"
                          />
                        ) : ps?.fileType === 'video' ? (
                          <ProtectedVideo
                            src={fileAbs}
                            className="mt-2 max-h-40 w-full rounded-md border"
                            controls
                          />
                        ) : null}
                      </div>
                    ) : null}

                    {showFeedback ? (
                      <div className="rounded-lg border-blue-200 bg-blue-50/70 p-3 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">Therapist feedback</p>
                        {feedbackText ? (
                          <p className="mt-1.5 text-sm leading-relaxed text-foreground">{feedbackText}</p>
                        ) : null}
                        {fb?.rating != null && fb.rating > 0 ? (
                          <p className="mt-1 text-sm text-blue-950">
                            Rating: <span className="font-medium">{fb.rating}/5</span>
                          </p>
                        ) : null}
                        {fb?.reviewedAt ? (
                          <p className="mt-1 text-xs text-blue-800/90">
                            Reviewed {formatDate(typeof fb.reviewedAt === 'string' ? fb.reviewedAt : String(fb.reviewedAt))}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Progress */}
      <Card className="border-blue-100 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-700" />
            <CardTitle className="text-lg">Progress</CardTitle>
          </div>
          <CardDescription>High-level view from your care team&apos;s therapy program.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading progress…
            </div>
          ) : parentEngineView?.headline ? (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-semibold text-foreground">{parentEngineView.headline}</p>
                <p className="text-sm text-muted-foreground mt-1">{parentEngineView.message}</p>
                {parentEngineView.confidenceLabel ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Confidence: <span className="font-medium capitalize">{parentEngineView.confidenceLabel}</span>
                  </p>
                ) : null}
              </div>
              <LowConfidenceBanner
                visible={Boolean(parentEngineView.interpretWithCaution)}
                message="Interpret with caution — progress scores may not be precise with current data volume."
              />
              {parentEngineView.progressPercent != null ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Overall progress across therapy goals</span>
                    <span>{parentEngineView.progressPercent}%</span>
                  </div>
                  <Progress value={parentEngineView.progressPercent} className="h-3" />
                </div>
              ) : parentEngineView.interpretWithCaution ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                  Overall progress: Limited data — your therapist will contextualize trends.
                </p>
              ) : null}
              {parentEngineView.consistencyPercent != null ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Home practice consistency</span>
                    <span>{parentEngineView.consistencyPercent}%</span>
                  </div>
                  <Progress value={parentEngineView.consistencyPercent} className="h-3" />
                  {parentEngineView.homeProgramOnTrack != null ? (
                    <p className="text-xs text-muted-foreground">
                      {parentEngineView.homeProgramOnTrack === false
                        ? 'Needs attention — your therapist can suggest small daily routines.'
                        : 'On track — thank you for staying engaged.'}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Badge
                variant="outline"
                className={
                  parentEngineView.trendLabel === 'needs_attention'
                    ? 'border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100'
                    : parentEngineView.trendLabel === 'improving'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/25 dark:text-emerald-100'
                      : 'border-primary/25 bg-primary/10 font-semibold text-primary dark:bg-primary/20 dark:text-primary-foreground'
                }
              >
                {parentEngineView.trendLabel === 'improving'
                  ? 'Improving'
                  : parentEngineView.trendLabel === 'needs_attention'
                    ? 'Needs attention'
                    : 'Steady'}
              </Badge>
              {parentEngineView.goalsBrief?.length ? (
                <div className="space-y-3 pt-2">
                  <p className="text-sm font-medium text-foreground">Goals</p>
                  {parentEngineView.goalsBrief.map((g) => {
                    // Same 0–5 → % conversion the reports use, so the numbers match the PDF.
                    const pct = g.current != null ? Math.round((Math.min(5, Math.max(0, Number(g.current))) / 5) * 100) : null;
                    const trend = String(g.trend || '').toLowerCase();
                    return (
                      <div key={g.goalId || g.goalName} className="space-y-1">
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 text-foreground">{g.goalName}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-foreground">
                            {pct != null ? `${pct}%` : '—'}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {trend === 'improving' ? 'Improving' : trend === 'declining' ? 'Needs support' : 'Steady'}
                            </span>
                          </span>
                        </div>
                        <Progress value={pct ?? 0} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {parentEngineView.alertsParent?.length ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">Updates from analytics</p>
                  <ClinicalAlertsPanel alerts={parentEngineView.alertsParent} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No progress data yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Parent-friendly therapy plan summary */}
      <Card className="border-blue-100 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-blue-700" />
            <CardTitle className="text-lg">Therapy plan summary</CardTitle>
          </div>
          <CardDescription>
            Family-friendly overview of goals and planned activities from your care team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading therapy plan summary…
            </div>
          ) : !therapyPlan ? (
            <p className="text-sm text-muted-foreground">
              No therapy plan summary is available yet for this case.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {(therapyPlan.domains || []).slice(0, 6).map((d) => (
                  <Badge key={String(d)} variant="outline" className="bg-background">
                    {String(d)}
                  </Badge>
                ))}
                {therapyPlan.status ? (
                  <Badge variant="outline" className="capitalize">
                    {String(therapyPlan.status)}
                  </Badge>
                ) : null}
                {therapyPlan.approval?.status && therapyPlan.approval.status !== 'none' ? (
                  <Badge variant="outline" className="capitalize">
                    approval: {String(therapyPlan.approval.status)}
                  </Badge>
                ) : null}
              </div>

              {therapyPlan.longTermGoal?.title ? (
                <div className="rounded-lg border bg-background/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Long-term focus</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {therapyPlan.longTermGoal.title}
                  </p>
                  {therapyPlan.longTermGoal.description ? (
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                      {therapyPlan.longTermGoal.description}
                    </p>
                  ) : null}
                  {therapyPlan.longTermGoal.timeline ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Timeline: {therapyPlan.longTermGoal.timeline}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Short-term goals</p>
                {Array.isArray(therapyPlan.shortTermGoals) && therapyPlan.shortTermGoals.length > 0 ? (
                  <ul className="space-y-2">
                    {therapyPlan.shortTermGoals.slice(0, 6).map((g, idx) => {
                      const st = String(g.status || 'Active').toLowerCase();
                      return (
                        <li key={`${String(g.title || 'goal')}-${idx}`} className="rounded-md border bg-background p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{String(g.title || 'Goal')}</p>
                            {g.domain ? (
                              <Badge variant="outline" className="text-xs">
                                {String(g.domain)}
                              </Badge>
                            ) : null}
                            <Badge className={GOAL_STATUS_BADGE[st] || GOAL_STATUS_BADGE.active}>
                              {String(g.status || 'Active')}
                            </Badge>
                          </div>
                          {g.measurableCriteria ? (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {String(g.measurableCriteria)}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No short-term goals listed yet.</p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planned activities</p>
                {Array.isArray(therapyPlan.activities) && therapyPlan.activities.length > 0 ? (
                  <ul className="space-y-2">
                    {therapyPlan.activities.slice(0, 6).map((a, idx) => (
                      <li key={`${String(a.title || 'activity')}-${idx}`} className="rounded-md border bg-background p-3">
                        <p className="text-sm font-medium text-foreground">{String(a.title || 'Activity')}</p>
                        {a.linkedGoal ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Linked to goal: {String(a.linkedGoal)}
                          </p>
                        ) : null}
                        {a.description ? (
                          <p className="mt-1 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                            {String(a.description)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No plan activities added yet.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Tip: activities become actionable for home when your therapist assigns them in the Home assignments section.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
