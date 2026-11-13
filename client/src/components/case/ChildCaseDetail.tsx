import { useEffect, useState } from 'react';
import { caseAPI, progressEngineAPI } from '../../api';
import { CaseFileNumbers } from './CaseFileNumbers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Loader2, ArrowLeft, AlertCircle, ClipboardList, Users, Activity, TrendingUp, FlaskConical } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ClinicalEvaluationTab } from '../evaluation/ClinicalEvaluationTab';
import { ReferralTab } from '../referral/ReferralTab';
import { TherapyOversightTab } from '../therapy/TherapyOversightTab';
import { ProgressMonitoringTab } from '../progress/ProgressMonitoringTab';
import { ClinicianCaseReports } from '../reports/ClinicianCaseReports';
import { cn } from '../ui/utils';
import { ChildCaseLabModule } from './ChildCaseLabModule';
import { CaseTimelineView } from './CaseTimelineView';

export type ChildCaseDetailTab =
  | 'timeline'
  | 'overview'
  | 'evaluation'
  | 'referrals'
  | 'therapy'
  | 'progress'
  | 'reports'
  | 'lab';

export interface ChildCaseDetailProps {
  caseId: string;
  onBack: () => void;
  /** When opening from clinician cockpit quick actions. */
  initialTab?: ChildCaseDetailTab;
}

const riskBadgeClass: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800 border-blue-200',
  medium: 'bg-yellow-100 text-yellow-900 border-yellow-200',
  high: 'bg-muted text-destructive border',
  unknown: 'bg-muted text-foreground border',
};

type ProgressEngineCaseSummary = {
  overallScore: number;
  improvementRate: number;
  weakestDomain: string | null;
  trend: string;
  alertCount?: number;
};

function snapshotTrendClass(t?: string) {
  const x = String(t || '').toLowerCase();
  if (x === 'improving') return 'border-emerald-200/90 bg-emerald-50 text-emerald-900';
  if (x === 'declining') return 'border-red-200/90 bg-red-50 text-red-900';
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

export function ChildCaseDetail({ caseId, onBack, initialTab = 'overview' }: ChildCaseDetailProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peSummary, setPeSummary] = useState<ProgressEngineCaseSummary | null>(null);
  const [peSummaryLoading, setPeSummaryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ChildCaseDetailTab>('overview');

  useEffect(() => {
    setActiveTab(initialTab || 'overview');
  }, [caseId, initialTab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data: res } = await caseAPI.getById(caseId);
        if (!cancelled && res.success) {
          setData(res.data);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.response?.data?.message || 'Failed to load case');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setPeSummaryLoading(true);
        const res = await progressEngineAPI.getSummary(caseId);
        const d = (res.data as { data?: ProgressEngineCaseSummary })?.data;
        if (!cancelled) setPeSummary(d && typeof d === 'object' ? d : null);
      } catch {
        if (!cancelled) setPeSummary(null);
      } finally {
        if (!cancelled) setPeSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const childName = data?.childProfile
    ? `${data.childProfile.firstName || ''} ${data.childProfile.lastName || ''}`.trim()
    : 'Child';
  const screening = data?.screeningSummary || {};
  const caseStatus = String(data?.status || 'NEW');
  const statusLabelMap: Record<string, string> = {
    NEW: 'New',
    SCREENING: 'Screening in progress',
    REVIEW: 'Awaiting clinician evaluation',
    DIAGNOSIS: 'Lab tests in progress',
    DIAGNOSIS_READY: 'Lab report ready for clinician review',
    THERAPY: 'Therapy assignment pending',
    THERAPY_ACTIVE: 'Therapy active',
    MONITORING: 'Monitoring',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to cases
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border bg-muted px-4 py-3 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div>
  <h2 className="text-2xl font-semibold text-primary">{childName}</h2>
              <p className="text-muted-foreground text-sm mt-1">Child case · ID {data._id}</p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">Case status</span>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-900">
                {statusLabelMap[caseStatus] || caseStatus}
              </Badge>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) =>
              setActiveTab(
                v as
                  | 'timeline'
                  | 'overview'
                  | 'evaluation'
                  | 'referrals'
                  | 'therapy'
                  | 'progress'
                  | 'reports'
                  | 'lab'
              )
            }
          >
            <TabsList className="w-full justify-start sm:w-auto">
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="evaluation">Clinical Evaluation</TabsTrigger>
              <TabsTrigger value="referrals">Referrals</TabsTrigger>
              <TabsTrigger value="therapy">Therapy Oversight</TabsTrigger>
              <TabsTrigger value="progress">Progress Monitoring</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
              <TabsTrigger value="lab" className="gap-1">
                <FlaskConical className="h-3.5 w-3.5" />
                Lab
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="pt-2">
              <CaseTimelineView caseId={caseId} />
            </TabsContent>

            <TabsContent value="overview" className="space-y-6 pt-2">
              <Card className="overflow-hidden border border-slate-200/90 bg-card shadow-md">
                <CardHeader className="border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-sky-50/35 px-6 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
                        <TrendingUp className="h-4 w-4 text-sky-700" aria-hidden />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold tracking-tight text-slate-900">
                          Therapy progress snapshot
                        </CardTitle>
                        <CardDescription className="text-sm text-slate-600">
                          Unified progress engine — composite score, trajectory, and domain focus for rounds.
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-6 py-5">
                  {peSummaryLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-8 text-sm text-slate-600">
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-600" aria-hidden />
                      Loading clinical summary…
                    </div>
                  ) : !peSummary ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-600">
                      No summary available yet. This usually appears once there is an active therapy plan and session
                      data.
                    </div>
                  ) : (
                    <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="border-b border-slate-100 p-4 sm:border-b-0 sm:border-r lg:border-r">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Composite (0–5)
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                          {(peSummary.overallScore ?? 0).toFixed(2)}
                          <span className="text-sm font-normal text-slate-500"> / 5</span>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Therapy + home weighted blend</p>
                      </div>
                      <div className="border-b border-slate-100 p-4 sm:border-b-0 lg:border-r">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Improvement rate
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                          {peSummary.improvementRate != null ? peSummary.improvementRate.toFixed(3) : '—'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">From smoothed weekly trend</p>
                      </div>
                      <div className="border-b border-slate-100 p-4 sm:border-b-0 sm:border-r lg:border-r">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Focus domain
                        </p>
                        <p className="mt-1 text-base font-semibold capitalize text-slate-900">
                          {peSummary.weakestDomain || '—'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Lowest current domain score</p>
                      </div>
                      <div className="p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Trajectory</p>
                        <Badge
                          variant="outline"
                          className={cn('mt-2 px-3 py-1 text-xs font-semibold capitalize', snapshotTrendClass(peSummary.trend))}
                        >
                          {peSummary.trend || '—'}
                        </Badge>
                        {typeof peSummary.alertCount === 'number' && peSummary.alertCount > 0 ? (
                          <p className="mt-3 text-xs font-medium text-amber-800">
                            {peSummary.alertCount} active engine alert
                            {peSummary.alertCount === 1 ? '' : 's'} — review Progress tab
                          </p>
                        ) : (
                          <p className="mt-3 text-xs text-slate-500">No open engine alerts</p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border shadow-sm bg-card">
                  <CardHeader className="border-b border bg-blue-50/50">
                    <CardTitle className="text-base flex items-center gap-2 text-blue-900">
                      <Users className="h-5 w-5" />
                      Child profile
                    </CardTitle>
                    <CardDescription>Linked from parent account</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4 text-sm">
                    <CaseFileNumbers caseId={String(caseId)} fileNumber={data.fileNumber} mrNumber={data.mrNumber} />
                    {data.childProfile ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-muted-foreground text-xs uppercase tracking-wide">Name</p>
                            <p className="font-medium text-foreground">{childName}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs uppercase tracking-wide">Gender</p>
                            <p className="text-foreground capitalize">{data.childProfile.gender || '—'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs uppercase tracking-wide">Date of birth</p>
                            <p className="text-foreground">
                              {data.childProfile.dateOfBirth
                                ? new Date(data.childProfile.dateOfBirth).toLocaleDateString()
                                : '—'}
                            </p>
                          </div>
                        </div>
                        {(data.childProfile.medicalHistory || data.childProfile.allergies) && (
                          <div className="pt-2 border-t border space-y-2">
                            {data.childProfile.medicalHistory && (
                              <div>
                                <p className="text-muted-foreground text-xs uppercase tracking-wide">Medical history</p>
                                <p className="text-foreground">{data.childProfile.medicalHistory}</p>
                              </div>
                            )}
                            {data.childProfile.allergies && (
                              <div>
                                <p className="text-muted-foreground text-xs uppercase tracking-wide">Allergies</p>
                                <p className="text-foreground">{data.childProfile.allergies}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">Child profile could not be loaded.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border shadow-sm bg-card">
                  <CardHeader className="border-b border bg-blue-50/50">
                    <CardTitle className="text-base flex items-center gap-2 text-blue-900">
                      <Users className="h-5 w-5" />
                      Parent / guardian
                    </CardTitle>
                    <CardDescription>Primary contact</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3 text-sm">
                    {data.parentInfo ? (
                      <>
                        <p className="font-medium text-foreground">
                          {data.parentInfo.firstName} {data.parentInfo.lastName}
                        </p>
                        <p className="text-foreground">{data.parentInfo.email}</p>
                        {data.parentInfo.phoneNumber && (
                          <p className="text-muted-foreground">{data.parentInfo.phoneNumber}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">Parent information unavailable.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="border shadow-sm bg-card">
                <CardHeader className="border-b border bg-blue-50/50">
                  <CardTitle className="text-base flex items-center gap-2 text-blue-900">
                    <ClipboardList className="h-5 w-5" />
                    Screening summary
                  </CardTitle>
                  <CardDescription>M-CHAT-R / ASQ-3 data from screening module</CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  {!screening.hasScreening ? (
                    <div className="rounded-lg border-yellow-200 bg-yellow-50 px-4 py-3 text-yellow-900 text-sm">
                      {screening.message || 'No screening data on file for this child yet.'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {screening.latest && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Latest tool</p>
                            <p className="font-medium text-foreground">{screening.latest.questionnaireType}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Result</p>
                            <p className="font-medium text-foreground">{screening.latest.result}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Risk (from screening)</p>
                            <Badge
                              variant="outline"
                              className={
                                riskBadgeClass[screening.latest.riskLevel] || riskBadgeClass.unknown
                              }
                            >
                              {screening.latest.riskLevel}
                            </Badge>
                          </div>
                        </div>
                      )}
                      {screening.latest?.resultDescription && (
                        <p className="text-sm text-foreground border-t border pt-4">
                          {screening.latest.resultDescription}
                        </p>
                      )}
                      {Array.isArray(screening.submissions) && screening.submissions.length > 0 && (
                        <div className="border-t border pt-4">
                          <p className="text-xs font-semibold text-muted-foreground mb-2">All submissions</p>
                          <ul className="space-y-2 text-sm">
                            {screening.submissions.map((s: any) => (
                              <li
                                key={s.submissionId}
                                className="flex flex-wrap gap-2 justify-between px-3 py-2 rounded-md bg-background border"
                              >
                                <span className="text-foreground">{s.questionnaireType}</span>
                                <span className="text-muted-foreground">{s.result}</span>
                                <Badge variant="outline" className="text-xs">
                                  {s.riskLevel}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border shadow-sm bg-card">
                <CardHeader className="border-b border bg-blue-50/50">
                  <CardTitle className="text-base flex items-center gap-2 text-blue-900">
                    <Activity className="h-5 w-5" />
                    Case risk indicator
                  </CardTitle>
                  <CardDescription>Stored on the case record (from latest screening when available)</CardDescription>
                </CardHeader>
                <CardContent className="pt-6 flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className={riskBadgeClass[data.riskLevel] || riskBadgeClass.unknown}
                  >
                    {data.riskLevel}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Status is state-driven and updates automatically as screening, lab, and therapy events occur.
                  </span>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="evaluation" className="pt-2">
              <ClinicalEvaluationTab
                caseId={caseId}
                childName={childName}
                onCreateReferral={() => setActiveTab('referrals')}
              />
            </TabsContent>

            <TabsContent value="referrals" className="pt-2">
              <ReferralTab caseId={caseId} />
            </TabsContent>

            <TabsContent value="therapy" className="pt-2">
              <TherapyOversightTab caseId={caseId} />
            </TabsContent>

            <TabsContent value="progress" className="pt-2">
              <ProgressMonitoringTab caseId={caseId} />
            </TabsContent>

            <TabsContent value="reports" className="pt-2">
              <ClinicianCaseReports caseId={caseId} />
            </TabsContent>

            <TabsContent value="lab" className="pt-2">
              <ChildCaseLabModule
                childId={
                  data?.childProfile?.id
                    ? String(data.childProfile.id)
                    : data?.childId
                      ? String(data.childId)
                      : undefined
                }
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
