import React, { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FileText,
  Home,
  Lightbulb,
  StickyNote,
  Stethoscope,
  Target,
  TrendingUp,
  User,
} from 'lucide-react';
import {
  DomainBarChart,
  GoalProgressTable,
  MetricsCard,
  ProgressBar,
  ReportChartsZone,
  ReportDetailsZone,
  ReportHeader,
  ReportHeaderZone,
  ReportLayout,
  ReportRecommendationsZone,
  ReportSection,
  ReportSummaryZone,
  SessionsTable,
  TrendLineChart,
} from './ui';
import {
  ClinicalAlertsPanel,
  DomainPerformanceBarChart,
  GoalClinicalCard,
  GoalProgressLineChart,
  GoalWhyModal,
  LowConfidenceBanner,
  trendIcon,
} from '../progress-clinical';
import { StandardReportView, isStandardReport } from './StandardReportView';

type AnyRecord = Record<string, any>;

type SummaryMetric = {
  label: string;
  value: string | number;
  suffix?: string;
  highlight?: 'blue' | 'green' | 'yellow' | 'neutral';
};

type GoalRow = {
  goalName?: string;
  baseline?: number | null;
  current?: number | null;
  target?: number | null;
  trend?: string;
  masteryStatus?: string;
};

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function asArray<T = AnyRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function normalizeTrendData(data: AnyRecord): Array<{ x: string; y: number }> {
  const rawTrend = asRecord(data.trendGraphData);
  const series = asArray<any>(rawTrend.weeklyTrend || rawTrend.monthlyTrend || data.trendGraphData);
  return series
    .map((item) => {
      const point = asRecord(item);
      const x = String(point.x || point.label || point.week || point.date || '');
      const y = toNumber(point.y ?? point.value ?? point.score);
      if (!x || y == null) return null;
      return { x, y };
    })
    .filter((item): item is { x: string; y: number } => Boolean(item));
}

function normalizeDomainData(
  data: AnyRecord
): Array<{ name: string; score: number; status?: string }> {
  const domains = asArray<any>(data.domainPerformance || data.domainProgress);
  return domains
    .map((item) => {
      const row = asRecord(item);
      const name = String(row.name || row.domain || '');
      const score = toNumber(row.score ?? row.progressPercent ?? row.progress);
      if (!name || score == null) return null;
      const normalized = row.progressPercent != null && row.score == null ? score / 20 : score;
      return {
        name,
        score: Math.max(0, Math.min(5, normalized)),
        status: row.status || row.trend,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function normalizeGoalRows(data: AnyRecord): GoalRow[] {
  const source = asArray<any>(
    data.goalProgressTable || asRecord(data.progressSummary).goalProgress || asRecord(data.goalsProgress).goals
  );
  return source.map((row) => {
    const item = asRecord(row);
    return {
      goalName: item.goalName || item.title,
      baseline: toNumber(item.baseline),
      current: toNumber(item.current ?? item.progressPercent),
      target: toNumber(item.target),
      trend: item.trend,
      masteryStatus: item.masteryStatus || item.status,
    };
  });
}

function normalizeRecommendations(data: AnyRecord): string[] {
  const list = data.recommendations;
  if (Array.isArray(list)) return list.map((item) => String(item)).filter(Boolean);
  if (typeof list === 'string') {
    return list
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function InsufficientDataBanner() {
  return (
    <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-900 shadow-sm">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        Insufficient data
      </div>
      <p className="mt-1 text-yellow-800/80">
        Add a therapy plan, session logs, or home assignments to generate a full report.
      </p>
    </div>
  );
}

function InfoGrid({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (!rows.length) return <p className="text-sm text-slate-400">No details available.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">{row.label}</p>
          <p className="mt-1 font-medium text-slate-800">{row.value || '—'}</p>
        </div>
      ))}
    </div>
  );
}

function RecommendationsList({ items }: { items: string[] }) {
  if (!items.length) {
    return <p className="text-sm text-slate-400">No recommendations at this time.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className="flex gap-3 rounded-lg bg-yellow-50/60 p-3 text-sm text-yellow-900"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function TextList({
  items,
  emptyText,
  tone = 'neutral',
}: {
  items: string[];
  emptyText: string;
  tone?: 'neutral' | 'green' | 'yellow';
}) {
  if (!items.length) return <p className="text-sm text-slate-400">{emptyText}</p>;

  const toneClass =
    tone === 'green'
      ? 'bg-green-50 text-green-900'
      : tone === 'yellow'
      ? 'bg-yellow-50 text-yellow-900'
      : 'bg-slate-50 text-slate-700';

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className={`rounded-lg p-3 text-sm ${toneClass}`}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function UnifiedReportTemplate({
  reportType,
  data,
  summaryMetrics,
  topDetails,
  extraDetails,
}: {
  reportType: string;
  data: AnyRecord;
  summaryMetrics: SummaryMetric[];
  topDetails?: React.ReactNode;
  extraDetails?: React.ReactNode;
}) {
  const childInfo = asRecord(data.childInfo);
  const goalRows = normalizeGoalRows(data);
  const trendData = normalizeTrendData(data);
  const domainData = normalizeDomainData(data);
  const recommendations = normalizeRecommendations(data);

  return (
    <ReportLayout>
      <ReportHeaderZone>
        <ReportHeader
          reportType={reportType}
          childName={childInfo.childName}
          age={toNumber(childInfo.age)}
          generatedAt={String(data.generatedAt || '')}
        />
      </ReportHeaderZone>

      {!!summaryMetrics.length && (
        <ReportSummaryZone>
          {summaryMetrics.map((metric) => (
            <MetricsCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              suffix={metric.suffix}
              highlight={metric.highlight || 'neutral'}
            />
          ))}
        </ReportSummaryZone>
      )}

      {topDetails}

      {(trendData.length > 0 || domainData.length > 0) && (
        <ReportChartsZone>
          {!!trendData.length && (
            <ReportSection title="Progress Trend" icon={<TrendingUp className="h-4 w-4" />} highlight="blue">
              <TrendLineChart data={trendData} xLabel="Period" yLabel="Score" />
            </ReportSection>
          )}
          {!!domainData.length && (
            <ReportSection title="Domain Performance" icon={<BarChart3 className="h-4 w-4" />} highlight="green">
              <DomainBarChart data={domainData} />
            </ReportSection>
          )}
        </ReportChartsZone>
      )}

      <ReportDetailsZone>
        {!!goalRows.length && (
          <ReportSection title="Goal Progress" icon={<Target className="h-4 w-4" />} highlight="neutral">
            <GoalProgressTable data={goalRows} />
          </ReportSection>
        )}
        {extraDetails}
      </ReportDetailsZone>

      <ReportRecommendationsZone>
        <ReportSection
          title="Recommendations"
          icon={<Lightbulb className="h-4 w-4" />}
          highlight={recommendations.length ? 'yellow' : 'neutral'}
        >
          <RecommendationsList items={recommendations} />
        </ReportSection>
      </ReportRecommendationsZone>
    </ReportLayout>
  );
}

function IntegratedReportEngineView({ data, engine }: { data: AnyRecord; engine: AnyRecord }) {
  const duration = asRecord(data.therapyDuration);
  const therapistNotes = asArray<string>(data.therapistNotes);
  const recommendations = normalizeRecommendations(data);
  const childInfo = asRecord(data.childInfo);
  const conf = asRecord(engine.confidence);
  const overallLimited = Boolean((toNumber(conf.overall) ?? 1) < 0.4);
  const domainRows = asArray<any>(engine.domainScores?.length ? engine.domainScores : engine.domains).map(
    (row) => {
      const r = asRecord(row);
      const score = toNumber(r.score);
      const confidence = toNumber(r.confidence ?? r.confidenceScore) ?? undefined;
      return {
        name: String(r.name || ''),
        score: score != null ? Math.max(0, Math.min(5, score)) : 0,
        confidence,
      };
    }
  );
  const goals = asArray<any>(engine.goals);
  const alerts = asArray<any>(engine.smartAlerts);
  const weekly = asArray<any>(engine.weeklyTrend).map((w) => {
    const row = asRecord(w);
    return {
      x: String(row.x || row.week || ''),
      y: toNumber(row.y) ?? 0,
    };
  });
  const [whyGoal, setWhyGoal] = useState<AnyRecord | null>(null);

  const summary: SummaryMetric[] = [
    {
      label: 'Overall Score (0–5)',
      value: overallLimited ? 'Limited data' : String(toNumber(engine.overallScore)?.toFixed(2) ?? '—'),
      suffix: overallLimited ? undefined : '',
      highlight: 'blue',
    },
    {
      label: 'Overall trend',
      value: `${trendIcon(String(engine.overallTrend || ''))} ${String(engine.overallTrend || '—')}`,
      highlight: 'green',
    },
    {
      label: 'Confidence',
      value: `${String(conf.label || '—')}${conf.overall != null ? ` (${(Number(conf.overall) * 100).toFixed(0)}%)` : ''}`,
      highlight: 'yellow',
    },
  ];

  return (
    <ReportLayout>
      <ReportHeaderZone>
        <ReportHeader
          reportType="integrated"
          childName={childInfo.childName}
          age={toNumber(childInfo.age)}
          generatedAt={String(data.generatedAt || '')}
        />
      </ReportHeaderZone>

      <LowConfidenceBanner
        visible={overallLimited}
        message="Interpret with caution: overall confidence is low (limited or inconsistent session data)."
      />

      <ReportSummaryZone>
        {summary.map((metric) => (
          <MetricsCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            suffix={metric.suffix}
            highlight={metric.highlight || 'neutral'}
          />
        ))}
      </ReportSummaryZone>

      <ReportChartsZone>
        <ReportSection title="Composite trend (engine)" icon={<TrendingUp className="h-4 w-4" />} highlight="blue">
          {weekly.length > 0 ? (
            <TrendLineChart data={weekly} xLabel="Session period" yLabel="Score (0–5)" />
          ) : (
            <p className="text-sm text-slate-400">Insufficient points for composite trend.</p>
          )}
        </ReportSection>
        <ReportSection title="Domains (confidence-colored)" icon={<BarChart3 className="h-4 w-4" />} highlight="green">
          <DomainPerformanceBarChart data={domainRows} height={240} />
        </ReportSection>
      </ReportChartsZone>

      <ReportSection title="Therapy Timeline" icon={<Calendar className="h-4 w-4" />} highlight="blue">
        <InfoGrid
          rows={[
            { label: 'Sessions Completed', value: String(duration.completedSessionCount ?? '—') },
            { label: 'Duration Span', value: duration.spanDays != null ? `${duration.spanDays} days` : '—' },
            { label: 'First Session', value: fmtDate(duration.firstSessionDate) },
            { label: 'Last Session', value: fmtDate(duration.lastSessionDate) },
          ]}
        />
      </ReportSection>

      {goals.length > 0 ? (
        <ReportDetailsZone>
          <ReportSection title="Goals — progress engine only" icon={<Target className="h-4 w-4" />} highlight="neutral">
            <div className="space-y-8">
              {goals.map((g: AnyRecord, idx: number) => (
                <div key={String(g.goalId || idx)} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <GoalClinicalCard
                    goal={{
                      goalId: g.goalId,
                      goalName: g.goalName,
                      current: toNumber(g.current),
                      trend: g.trend,
                      confidenceLabel: g.confidenceLabel,
                      confidenceScore: toNumber(g.confidenceScore) ?? undefined,
                      limitedDataUi: Boolean(g.limitedDataUi ?? (String(g.confidenceLabel) === 'low')),
                    }}
                    onWhy={() => setWhyGoal(g)}
                  />
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Session trajectory</p>
                    <GoalProgressLineChart
                      height={200}
                      data={asArray<AnyRecord>(g.timeSeries).map((t) => ({
                        date: (t.date as string) || null,
                        score: Number(t.score ?? 0),
                        smoothedScore:
                          t.smoothedScore != null && Number.isFinite(Number(t.smoothedScore))
                            ? Number(t.smoothedScore)
                            : undefined,
                        confidence:
                          t.confidence != null && Number.isFinite(Number(t.confidence))
                            ? Number(t.confidence)
                            : undefined,
                      }))}
                      explanationSnippet={String(g.reasoningSummary || '').slice(0, 120)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ReportSection>
        </ReportDetailsZone>
      ) : null}

      <ReportSection title="Clinical alerts" icon={<AlertTriangle className="h-4 w-4" />} highlight="yellow">
        <ClinicalAlertsPanel alerts={alerts} />
      </ReportSection>

      <ReportRecommendationsZone>
        <ReportSection title="Recommendations (engine-informed)" icon={<Lightbulb className="h-4 w-4" />}>
          <RecommendationsList items={recommendations} />
        </ReportSection>
      </ReportRecommendationsZone>

      <ReportSection title="Therapist Notes" icon={<StickyNote className="h-4 w-4" />}>
        {therapistNotes.length ? (
          <ul className="space-y-2">
            {therapistNotes.slice(-8).map((note, index) => (
              <li key={`${note}-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {note}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No notes captured.</p>
        )}
      </ReportSection>

      <GoalWhyModal
        open={Boolean(whyGoal)}
        onOpenChange={(open) => {
          if (!open) setWhyGoal(null);
        }}
        goal={whyGoal}
      />
    </ReportLayout>
  );
}

function IntegratedReportLegacyView({ data }: { data: AnyRecord }) {
  const duration = asRecord(data.therapyDuration);
  const metrics = asRecord(data.overallMetrics);
  const therapistNotes = asArray<string>(data.therapistNotes);

  const summary: SummaryMetric[] = [
    {
      label: 'Overall Score',
      value: toNumber(metrics.overallScore)?.toFixed(2) || '—',
      suffix: '/ 5',
      highlight: 'blue',
    },
    {
      label: 'Improvement Rate',
      value: toNumber(metrics.improvementRate) ?? '—',
      suffix: '%',
      highlight: 'green',
    },
    {
      label: 'Consistency',
      value: toNumber(metrics.consistency) != null ? `${Math.round((metrics.consistency || 0) * 100)}` : '—',
      suffix: '%',
      highlight: 'yellow',
    },
  ];

  return (
    <UnifiedReportTemplate
      reportType="integrated"
      data={data}
      summaryMetrics={summary}
      topDetails={
        <ReportSection title="Therapy Timeline" icon={<Calendar className="h-4 w-4" />} highlight="blue">
          <InfoGrid
            rows={[
              { label: 'Sessions Completed', value: String(duration.completedSessionCount ?? '—') },
              { label: 'Duration Span', value: duration.spanDays != null ? `${duration.spanDays} days` : '—' },
              { label: 'First Session', value: fmtDate(duration.firstSessionDate) },
              { label: 'Last Session', value: fmtDate(duration.lastSessionDate) },
            ]}
          />
        </ReportSection>
      }
      extraDetails={
        <ReportSection title="Therapist Notes" icon={<StickyNote className="h-4 w-4" />}>
          {therapistNotes.length ? (
            <ul className="space-y-2">
              {therapistNotes.slice(-8).map((note, index) => (
                <li key={`${note}-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  {note}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No notes captured.</p>
          )}
        </ReportSection>
      }
    />
  );
}

function IntegratedReportView({ data }: { data: AnyRecord }) {
  const pe = data.progressEngine;
  if (pe && typeof pe === 'object') {
    return <IntegratedReportEngineView data={data} engine={pe as AnyRecord} />;
  }
  return <IntegratedReportLegacyView data={data} />;
}

function MonthlyView({ data }: { data: AnyRecord }) {
  const progress = asRecord(data.goalsProgress);
  const sessionSummary = asRecord(data.sessionsSummary);
  const assignment = asRecord(data.assignmentCompliance);
  const clinicalContext = asRecord(data.clinicalContext);
  const goalRows = asArray<any>(progress.goals);
  const activities = asArray<any>(data.activitiesUsed).map((row) =>
    String(asRecord(row).activity || asRecord(row).name || row || '').trim()
  ).filter(Boolean);
  const notes = asArray<string>(data.therapistNotes).map((n) => String(n).trim()).filter(Boolean);
  const assignmentPercent =
    toNumber(assignment.compliancePercent) ??
    (() => {
      const completed = toNumber(assignment.completed);
      const total = toNumber(assignment.total);
      if (completed == null || total == null || total <= 0) return null;
      return Math.round((completed / total) * 100);
    })();

  const normalizedData = {
    ...data,
    goalProgressTable: goalRows,
  };

  return (
    <UnifiedReportTemplate
      reportType="monthly"
      data={normalizedData}
      summaryMetrics={[
        {
          label: 'Overall Goal Progress',
          value: toNumber(progress.overallProgressPercent) ?? 0,
          suffix: '%',
          highlight: 'blue',
        },
        {
          label: 'Sessions Logged',
          value: toNumber(sessionSummary.totalSessions) ?? 0,
          highlight: 'green',
        },
        {
          label: 'Assignment Compliance',
          value: assignmentPercent ?? '—',
          suffix: assignmentPercent != null ? '%' : '',
          highlight: 'yellow',
        },
      ]}
      topDetails={
        <ReportSection title="Monthly Snapshot" icon={<ClipboardList className="h-4 w-4" />} highlight="green">
          <InfoGrid
            rows={[
              { label: 'Therapy Domains', value: asArray<string>(data.therapyDomains).join(', ') || '—' },
              {
                label: 'Avg Child Response',
                value:
                  toNumber(sessionSummary.avgChildResponse) != null
                    ? String(toNumber(sessionSummary.avgChildResponse)?.toFixed(1))
                    : '—',
              },
            ]}
          />
        </ReportSection>
      }
      extraDetails={
        <>
          <ReportSection title="Activity Focus" icon={<BarChart3 className="h-4 w-4" />}>
            <TextList items={activities.slice(0, 8)} emptyText="No activity usage data available." />
          </ReportSection>
          <ReportSection title="Therapist Notes" icon={<StickyNote className="h-4 w-4" />}>
            <TextList items={notes.slice(0, 8)} emptyText="No therapist notes available." />
          </ReportSection>
          <ReportSection title="Clinical Context" icon={<User className="h-4 w-4" />}>
            <InfoGrid
              rows={[
                { label: 'Diagnosis Summary', value: String(clinicalContext.diagnosisSummary || '—') },
                { label: 'Clinical Recommendation', value: String(clinicalContext.recommendations || '—') },
              ]}
            />
          </ReportSection>
        </>
      }
    />
  );
}

function TherapyView({ data }: { data: AnyRecord }) {
  const therapyPlan = asRecord(data.therapyPlanSummary);
  const progress = asRecord(data.progress);
  const domains = asArray<any>(progress.domains);
  const shortGoals = asArray<any>(therapyPlan.shortTermGoals);
  const activities = asArray<any>(therapyPlan.activities);
  const normalizedData = {
    ...data,
    goalProgressTable: asArray<any>(progress.goals),
    domainPerformance: domains,
    recommendations: activities
      .slice(0, 8)
      .map((row) => String(asRecord(row).title || '').trim())
      .filter(Boolean),
  };

  return (
    <UnifiedReportTemplate
      reportType="therapy"
      data={normalizedData}
      summaryMetrics={[
        { label: 'Overall Progress', value: toNumber(progress.overallProgressPercent) ?? '—', suffix: '%', highlight: 'blue' },
        { label: 'Short-Term Goals', value: shortGoals.length, highlight: 'green' },
        { label: 'Activities Planned', value: activities.length, highlight: 'yellow' },
      ]}
      topDetails={
        <ReportSection title="Therapy Plan" icon={<Stethoscope className="h-4 w-4" />} highlight="green">
          <InfoGrid
            rows={[
              { label: 'Domains', value: asArray<string>(therapyPlan.domains).join(', ') || '—' },
              { label: 'Long-Term Goal', value: String(asRecord(therapyPlan.longTermGoal).title || '—') },
            ]}
          />
        </ReportSection>
      }
      extraDetails={
        <ReportSection title="Domain Progress Snapshot" icon={<BarChart3 className="h-4 w-4" />} highlight="blue">
          {domains.length ? (
            <div className="space-y-3">
              {domains.map((row, index) => (
                <ProgressBar
                  key={`${row.domain || row.name || index}`}
                  label={String(row.domain || row.name || `Domain ${index + 1}`)}
                  percent={toNumber(row.progressPercent) || 0}
                  trend={String(row.trend || row.status || '')}
                />
              ))}
            </div>
          ) : <p className="text-sm text-slate-400">No domain details available.</p>}
        </ReportSection>
      }
    />
  );
}

function SessionView({ data }: { data: AnyRecord }) {
  const sessionSummary = asRecord(data.sessionSummary);
  const recentSessions = asArray<any>(sessionSummary.recentSessions || data.sessions);

  return (
    <UnifiedReportTemplate
      reportType="session"
      data={data}
      summaryMetrics={[
        { label: 'Total Sessions', value: toNumber(sessionSummary.totalSessions) ?? 0, highlight: 'blue' },
        {
          label: 'Average Response',
          value: toNumber(sessionSummary.avgChildResponse)?.toFixed(1) || '—',
          highlight: 'green',
        },
      ]}
      extraDetails={
        <ReportSection title="Recent Sessions" icon={<FileText className="h-4 w-4" />} highlight="neutral">
          <SessionsTable data={recentSessions} />
        </ReportSection>
      }
    />
  );
}

function ProgressView({ data }: { data: AnyRecord }) {
  const progress = asRecord(data.progressSummary);
  const flags = asArray<any>(data.redFlags);
  const normalizedData = {
    ...data,
    goalProgressTable: asArray<any>(progress.goalProgress),
    domainPerformance: asArray<any>(progress.domainProgress),
    trendGraphData: { weeklyTrend: asArray<any>(progress.sessionTrend) },
  };

  return (
    <UnifiedReportTemplate
      reportType="progress"
      data={normalizedData}
      summaryMetrics={[
        {
          label: 'Overall Progress',
          value: toNumber(progress.overallProgressPercent) ?? 0,
          suffix: '%',
          highlight: 'blue',
        },
      ]}
      extraDetails={
        <ReportSection title="Attention Areas" icon={<AlertTriangle className="h-4 w-4" />} highlight="yellow">
          {flags.length ? (
            <ul className="space-y-2">
              {flags.map((flag, index) => (
                <li key={index} className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-900">
                  <span className="font-medium">{String(flag.domain || 'Domain')}</span>:&nbsp;
                  {String(flag.progressPercent ?? '—')}% ({String(flag.trend || 'stable')})
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
              No major attention flags from current analytics.
            </div>
          )}
        </ReportSection>
      }
    />
  );
}

function IepView({ data }: { data: AnyRecord }) {
  const longTermGoals = asArray<any>(data.longTermGoals);
  const shortTermGoals = asArray<any>(data.shortTermGoals);
  const statusSummary = asArray<any>(data.goalStatusSummary);
  const strategies = asArray<any>(data.recommendedStrategies);
  const reviewTimeline = asRecord(data.reviewTimeline);
  const normalizedData = {
    ...data,
    goalProgressTable: statusSummary.map((row) => ({
      goalName: row.goalName,
      current: toNumber(row.progressPercent),
      masteryStatus: row.status || 'Active',
    })),
    recommendations: strategies
      .map((row) => {
        const item = asRecord(row);
        const title = String(item.title || '').trim();
        const description = String(item.description || '').trim();
        if (!title) return '';
        return description ? `${title}: ${description}` : title;
      })
      .filter(Boolean),
  };

  return (
    <UnifiedReportTemplate
      reportType="iep"
      data={normalizedData}
      summaryMetrics={[
        { label: 'Long-Term Goals', value: longTermGoals.length, highlight: 'blue' },
        { label: 'Short-Term Goals', value: shortTermGoals.length, highlight: 'green' },
      ]}
      topDetails={
        <ReportSection title="IEP Focus" icon={<BookOpen className="h-4 w-4" />} highlight="blue">
          <InfoGrid
            rows={[
              {
                label: 'Domains',
                value:
                  Array.from(
                    new Set(shortTermGoals.map((row) => String(asRecord(row).domain || '').trim()).filter(Boolean))
                  ).join(', ') || '—',
              },
              { label: 'Suggested Review', value: fmtDate(reviewTimeline.suggestedReviewBy) },
            ]}
          />
        </ReportSection>
      }
    />
  );
}

function ClinicianView({ data }: { data: AnyRecord }) {
  const diagnosis = asRecord(data.diagnosis);
  const therapySummary = asRecord(data.therapyProgressSummary);
  const observations = asArray<string>(data.therapistObservations);
  const redFlags = asArray<any>(data.redFlags);
  const normalizedData = {
    ...data,
    goalProgressTable: asArray<any>(therapySummary.goalProgress),
    domainPerformance: asArray<any>(data.domainAnalysis),
  };

  return (
    <UnifiedReportTemplate
      reportType="clinician"
      data={normalizedData}
      summaryMetrics={[
        { label: 'Overall Progress', value: toNumber(therapySummary.overallProgress) ?? '—', suffix: '%', highlight: 'blue' },
        { label: 'Red Flags', value: redFlags.length, highlight: 'yellow' },
        { label: 'Recent Observations', value: observations.length, highlight: 'green' },
      ]}
      topDetails={
        <ReportSection title="Clinical Snapshot" icon={<User className="h-4 w-4" />} highlight="green">
          <InfoGrid
            rows={[
              { label: 'Diagnosis', value: String(diagnosis.diagnosis || diagnosis.message || '—') },
              { label: 'Comorbidities', value: asArray<string>(diagnosis.comorbidConditions).join(', ') || '—' },
            ]}
          />
        </ReportSection>
      }
      extraDetails={
        <>
          <ReportSection title="Therapist Observations" icon={<StickyNote className="h-4 w-4" />}>
            <TextList items={observations} emptyText="No therapist observations captured." />
          </ReportSection>
          <ReportSection title="Attention Areas" icon={<AlertTriangle className="h-4 w-4" />} highlight="yellow">
            <TextList
              items={redFlags.map((row) => {
                const item = asRecord(row);
                return `${String(item.domain || 'Domain')}: ${String(item.reason || 'Needs attention')} (${String(item.progressPercent ?? '—')}%, ${String(item.trend || 'stable')})`;
              })}
              emptyText="No critical red flags detected."
              tone="yellow"
            />
          </ReportSection>
        </>
      }
    />
  );
}

function ParentView({ data }: { data: AnyRecord }) {
  const improvements = asArray<string>(data.improvements).map((item) => String(item)).filter(Boolean);
  const attention = asArray<string>(data.areasNeedingAttention).map((item) => String(item)).filter(Boolean);
  const tips = asArray<string>(data.homeGuidanceTips).map((item) => String(item)).filter(Boolean);
  const normalizedData = {
    ...data,
    recommendations: tips,
  };

  return (
    <UnifiedReportTemplate
      reportType="parent"
      data={normalizedData}
      summaryMetrics={[
        { label: 'Improvements', value: improvements.length, highlight: 'green' },
        { label: 'Areas to Support', value: attention.length, highlight: 'yellow' },
      ]}
      topDetails={
        <ReportSection title="Parent Summary" icon={<Home className="h-4 w-4" />} highlight="blue">
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            {String(data.progressSummary || 'No summary available.')}
          </p>
        </ReportSection>
      }
      extraDetails={
        <>
          <ReportSection title="Positive Progress" icon={<TrendingUp className="h-4 w-4" />} highlight="green">
            <TextList items={improvements} emptyText="No specific improvements listed yet." tone="green" />
          </ReportSection>
          <ReportSection title="Needs Attention" icon={<AlertTriangle className="h-4 w-4" />} highlight="yellow">
            <TextList items={attention} emptyText="No attention areas listed." tone="yellow" />
          </ReportSection>
        </>
      }
    />
  );
}

export function ReportDocumentView({
  reportType,
  payload,
}: {
  reportType: string;
  payload: Record<string, unknown>;
}) {
  // Reports generated since the unified format: one layout and one set of numbers for every role.
  if (isStandardReport(payload)) {
    return <StandardReportView data={payload} />;
  }
  if (payload?.insufficientData && reportType !== 'integrated') {
    return <InsufficientDataBanner />;
  }

  const data = asRecord(payload);
  switch (reportType) {
    case 'integrated':
      return <IntegratedReportView data={data} />;
    case 'monthly':
      return <MonthlyView data={data} />;
    case 'therapy':
      return <TherapyView data={data} />;
    case 'session':
      return <SessionView data={data} />;
    case 'progress':
      return <ProgressView data={data} />;
    case 'iep':
      return <IepView data={data} />;
    case 'clinician':
      return <ClinicianView data={data} />;
    case 'parent':
      return <ParentView data={data} />;
    default:
      return (
        <ReportLayout>
          <ReportHeaderZone>
            <ReportHeader reportType={reportType} generatedAt={String(data.generatedAt || '')} />
          </ReportHeaderZone>
          <ReportSection title="Raw Report Data" icon={<FileText className="h-4 w-4" />}>
            <pre className="max-h-[480px] overflow-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-600">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </ReportSection>
        </ReportLayout>
      );
  }
}
