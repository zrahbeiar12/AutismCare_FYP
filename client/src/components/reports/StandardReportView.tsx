import './StandardReportView.css';

/**
 * Viewer for standard-v1 reports. Parents, clinicians and therapists all see this same layout and the same
 * numbers; only the audience section at the end differs by report type (mirrors the PDF template).
 */

type Zone = 'ok' | 'monitor' | 'refer' | 'incomplete' | 'unknown';

export type StandardReport = {
  schema: 'standard-v1';
  type: string;
  title: string;
  generatedAt: string;
  caseRef?: string;
  child?: { name?: string; ageText?: string | null; gender?: string | null; dateOfBirth?: string | null };
  parentName?: string | null;
  therapistName?: string | null;
  therapistSpecialization?: string | null;
  case?: { status?: string | null; riskLevel?: string | null };
  period?: { firstSessionDate?: string | null; lastSessionDate?: string | null; weeks?: number | null };
  screening?: {
    mchat?: { totalScore: number | null; maxScore?: number; riskLevel?: string; completedAt?: string } | null;
    asq3?: {
      intervalMonths?: number | null;
      completedAt?: string;
      domains?: { domain: string; score: number | null; maxScore?: number; referralCutoff?: number | null; zone: Zone }[];
    } | null;
  };
  stats?: Record<string, any>;
  summary?: string;
  domains?: { key: string; label: string; scorePct: number | null; trend: string; trendLabel: string }[];
  goals?: {
    goalId: string;
    name: string;
    domain: string;
    baselinePct: number | null;
    currentPct: number | null;
    targetPct: number | null;
    changePts: number | null;
    status: string;
  }[];
  trend?: { date: string; pct: number }[];
  highlights?: { improvements?: string[]; needsAttention?: string[] };
  recommendations?: string[];
  audience?: Record<string, any> & { kind?: string };
  disclaimer?: string;
};

export function isStandardReport(payload: unknown): payload is StandardReport {
  return Boolean(payload && typeof payload === 'object' && (payload as any).schema === 'standard-v1');
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const pct = (v?: number | null) => (v == null ? '—' : `${v}%`);
const pts = (v?: number | null) => (v == null ? '—' : v > 0 ? `+${v} pts` : `${v} pts`);
const signClass = (v?: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'rv-pos' : 'rv-neg');

function riskZone(r?: string | null): Zone {
  if (r === 'low') return 'ok';
  if (r === 'medium') return 'monitor';
  if (r === 'high') return 'refer';
  return 'unknown';
}
const ZONE_LABEL: Record<Zone, string> = { ok: 'Typical', monitor: 'Monitor', refer: 'Refer', incomplete: 'Incomplete', unknown: 'Unknown' };

function Chip({ zone, children }: { zone: Zone; children: React.ReactNode }) {
  return <span className={`zone-chip zone-${zone}`}>{children}</span>;
}

function goalZone(status: string): Zone {
  if (/achieved|target/i.test(status)) return 'ok';
  if (/support/i.test(status)) return 'refer';
  if (/not started/i.test(status)) return 'unknown';
  return 'monitor';
}

function Bar({ value }: { value: number | null | undefined }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="rv-track" role="img" aria-label={`${v}%`}>
      <div className="rv-fill" style={{ width: `${v}%` }} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rv-card">
      <div className="rv-h">
        <span className="rv-h-title">{title}</span>
        {hint ? <span className="rv-h-hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function List({ items, empty }: { items?: (string | null | undefined)[]; empty: string }) {
  const list = (items || []).filter(Boolean) as string[];
  if (!list.length) return <p className="rv-muted">{empty}</p>;
  return (
    <ul className="rv-list">
      {list.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function TrendChart({ points }: { points: { date: string; pct: number }[] }) {
  if (points.length < 2) return <p className="rv-muted">A trend line appears after two or more scored session days.</p>;
  const W = 640;
  const H = 200;
  const L = 36;
  const R = 12;
  const T = 10;
  const B = 28;
  const x = (i: number) => L + ((W - L - R) * i) / (points.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - Math.max(0, Math.min(100, v)) / 100);
  const step = Math.max(1, Math.ceil(points.length / 6));
  const last = points[points.length - 1];
  return (
    <svg className="rv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Progress over time, latest ${last.pct}%`}>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line className="rv-chart-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text className="rv-chart-text" x={L - 6} y={y(v) + 4} textAnchor="end">
            {v}%
          </text>
        </g>
      ))}
      <polyline className="rv-chart-line" points={points.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ')} />
      {points.map((p, i) => (
        <circle key={i} className={i === points.length - 1 ? 'rv-chart-last' : 'rv-chart-dot'} cx={x(i)} cy={y(p.pct)} r={3.5}>
          <title>{`${fmtDate(p.date)}: ${p.pct}%`}</title>
        </circle>
      ))}
      {points.map((p, i) =>
        i % step === 0 || i === points.length - 1 ? (
          <text key={`l${i}`} className="rv-chart-text" x={x(i)} y={H - 8} textAnchor="middle">
            {fmtDate(p.date).replace(/ \d{4}$/, '')}
          </text>
        ) : null
      )}
    </svg>
  );
}

function Audience({ a }: { a: Record<string, any> }) {
  switch (a?.kind) {
    case 'parent':
      return (
        <Section title="Ideas for home" hint="From the therapy plan and recent sessions">
          <List items={a.homeTips} empty="No home activities yet." />
        </Section>
      );
    case 'clinician':
    case 'integrated':
      return (
        <Section title="Clinical notes">
          <div className="rv-sub">Diagnosis</div>
          <List
            items={a.diagnosis ? [a.diagnosis.diagnosis, a.diagnosis.developmentalSummary && `Developmental summary: ${a.diagnosis.developmentalSummary}`] : []}
            empty="No finalised clinical evaluation on file."
          />
          <div className="rv-sub">Alerts</div>
          <List items={(a.alerts || []).map((x: any) => `${x.severity === 'critical' ? 'Critical' : 'Warning'}: ${x.message}`)} empty="No active alerts." />
          <div className="rv-sub">Therapist observations</div>
          <List items={a.therapistObservations} empty="No session notes yet." />
        </Section>
      );
    case 'iep':
      return (
        <Section title="IEP review" hint={`Next review by ${fmtDate(a.nextReviewBy)}`}>
          <div className="rv-sub">Long-term goal</div>
          <List items={a.longTermGoal ? [`${a.longTermGoal.title}${a.longTermGoal.description ? ` — ${a.longTermGoal.description}` : ''}`] : []} empty="Not set." />
          <div className="rv-sub">Short-term goals and criteria</div>
          <List
            items={(a.shortTermGoals || []).map((g: any) => `${g.title}${g.criteria ? ` — ${g.criteria}` : ''}${g.reviewDate ? ` (review ${fmtDate(g.reviewDate)})` : ''}`)}
            empty="No short-term goals."
          />
          <div className="rv-sub">Strategies</div>
          <List items={(a.strategies || []).map((s: any) => (s.description ? `${s.title}: ${s.description}` : s.title))} empty="No strategies listed." />
        </Section>
      );
    case 'therapy':
      return (
        <Section title="Therapy plan">
          <div className="rv-sub">Long-term goal</div>
          <List items={a.longTermGoal ? [`${a.longTermGoal.title}${a.longTermGoal.description ? ` — ${a.longTermGoal.description}` : ''}`] : []} empty="Not set." />
          <div className="rv-sub">Activities</div>
          <List items={(a.activities || []).map((s: any) => (s.description ? `${s.title}: ${s.description}` : s.title))} empty="No activities listed." />
        </Section>
      );
    case 'session':
      return (
        <Section title="Recent sessions">
          <List
            items={(a.recentSessions || []).map(
              (s: any) =>
                `${fmtDate(s.date)} · ${s.status}${s.durationMin ? ` · ${s.durationMin} min` : ''}${s.childResponse ? ` · response: ${s.childResponse}` : ''}${s.notes ? ` — ${s.notes}` : ''}`
            )}
            empty="No sessions logged."
          />
        </Section>
      );
    case 'monthly':
      return (
        <Section title="This month" hint={`${fmtDate(a.periodStart)} – ${fmtDate(a.periodEnd)}`}>
          <p>
            {a.sessionsThisMonth ?? 0} sessions completed, {a.missedThisMonth ?? 0} missed.
          </p>
          <div className="rv-sub">Therapist notes</div>
          <List items={a.therapistNotes} empty="No notes this month." />
        </Section>
      );
    default:
      return null;
  }
}

export function StandardReportView({ data }: { data: StandardReport }) {
  const s = data.stats || {};
  const period = data.period?.firstSessionDate
    ? `${fmtDate(data.period.firstSessionDate)} – ${fmtDate(data.period.lastSessionDate)}${data.period.weeks ? ` (${data.period.weeks} wk)` : ''}`
    : 'No sessions yet';
  const statusZone: Zone =
    s.clinicalStatus === 'on_track' ? 'ok' : s.clinicalStatus === 'needs_attention' ? 'monitor' : s.clinicalStatus === 'high_concern' ? 'refer' : 'unknown';
  const m = data.screening?.mchat;
  const a = data.screening?.asq3;

  return (
    <div className="rv">
      <header className="rv-head">
        <div className="rv-head-brand">AutismCare</div>
        <div className="rv-head-title">{data.title}</div>
        <div className="rv-head-meta">
          Generated {fmtDate(data.generatedAt)}
          {data.caseRef ? ` · Case ref ${data.caseRef}` : ''}
        </div>
      </header>

      <section className="rv-card rv-kv">
        {[
          ['Child', data.child?.name],
          ['Parent / guardian', data.parentName],
          ['Age', data.child?.ageText],
          ['Therapist', data.therapistName ? `${data.therapistName}${data.therapistSpecialization ? `, ${data.therapistSpecialization}` : ''}` : null],
          ['Gender', data.child?.gender],
          ['Therapy period', period],
        ].map(([k, v]) => (
          <div className="rv-kv-row" key={k as string}>
            <span className="rv-kv-k">{k}</span>
            <span className="rv-kv-v">{v || '—'}</span>
          </div>
        ))}
      </section>

      {data.summary ? <p className="rv-card rv-summary">{data.summary}</p> : null}

      <div className="rv-tiles">
        <div className="rv-card rv-tile">
          <div className="rv-tile-label">Overall progress</div>
          <div className="rv-tile-value">{pct(s.overallProgressPct)}</div>
          <Bar value={s.overallProgressPct} />
          <div className="rv-tile-sub">
            {s.overallTrendLabel}
            {s.dataConfidence ? ` · ${s.dataConfidence} data confidence` : ''}
          </div>
        </div>
        <div className="rv-card rv-tile">
          <div className="rv-tile-label">Change since baseline</div>
          <div className={`rv-tile-value ${signClass(s.improvementPts)}`}>{pts(s.improvementPts)}</div>
          <div className="rv-tile-sub">
            {s.baselinePct != null ? `${s.baselinePct}% → ${s.currentPct}% (goal average)` : 'Baseline not set'}
          </div>
        </div>
        <div className="rv-card rv-tile">
          <div className="rv-tile-label">Sessions completed</div>
          <div className="rv-tile-value">{s.sessionsCompleted ?? 0}</div>
          <Bar value={s.attendancePct} />
          <div className="rv-tile-sub">{s.attendancePct != null ? `${s.attendancePct}% attendance` : 'Attendance not recorded'}</div>
        </div>
        <div className="rv-card rv-tile">
          <div className="rv-tile-label">Home practice</div>
          <div className="rv-tile-value">{pct(s.homePracticePct)}</div>
          <Bar value={s.homePracticePct} />
          <div className="rv-tile-sub">
            {s.assignmentsCompleted ?? 0} of {s.assignmentsTotal ?? 0} activities done
          </div>
        </div>
      </div>

      <div className="rv-row">
        <span className="rv-muted">Clinical status</span>
        <Chip zone={statusZone}>{s.clinicalStatusLabel || 'Not enough data'}</Chip>
        <span className="rv-muted">
          · Goals achieved {s.goalsAchieved ?? 0} of {s.goalsTotal ?? 0}
        </span>
      </div>

      <Section title="Progress by area" hint="Average of the goals in each area">
        {(data.domains || []).length ? (
          (data.domains || []).map((d) => (
            <div className="rv-domain" key={d.key}>
              <span>{d.label}</span>
              <Bar value={d.scorePct} />
              <span className="rv-num">{pct(d.scorePct)}</span>
              <span className={`rv-trend rv-trend-${d.trend}`}>{d.trendLabel}</span>
            </div>
          ))
        ) : (
          <p className="rv-muted">No goals with scored sessions yet.</p>
        )}
      </Section>

      <Section title="Goal progress" hint="Baseline and target from the plan; current = recent sessions">
        {(data.goals || []).length ? (
          <div className="rv-table-wrap">
            <table className="rv-table">
              <thead>
                <tr>
                  <th>Goal</th>
                  <th>Area</th>
                  <th className="rv-r">Baseline</th>
                  <th className="rv-r">Current</th>
                  <th className="rv-r">Target</th>
                  <th className="rv-r">Change</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.goals || []).map((g) => (
                  <tr key={g.goalId}>
                    <td>{g.name}</td>
                    <td className="rv-muted">{g.domain}</td>
                    <td className="rv-r">{pct(g.baselinePct)}</td>
                    <td className="rv-r" style={{ fontWeight: 600 }}>
                      {pct(g.currentPct)}
                    </td>
                    <td className="rv-r">{pct(g.targetPct)}</td>
                    <td className={`rv-r ${signClass(g.changePts)}`}>{pts(g.changePts)}</td>
                    <td>
                      <Chip zone={goalZone(g.status)}>{g.status}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rv-muted">No goals in the therapy plan yet.</p>
        )}
      </Section>

      <Section title="Progress over time" hint="Average score per session day">
        <TrendChart points={data.trend || []} />
      </Section>

      <Section title="Screening results">
        <div className="rv-row" style={{ marginBottom: '0.75rem' }}>
          <strong style={{ minWidth: '5.5rem' }}>M-CHAT-R</strong>
          {m ? (
            <>
              <span>
                Score {m.totalScore ?? '—'} / {m.maxScore || 20}
              </span>
              <span className={`zone-chip risk-${m.riskLevel || 'unknown'}`}>{(m.riskLevel || 'unknown').replace(/^\w/, (c) => c.toUpperCase())} likelihood</span>
              <span className="rv-muted">completed {fmtDate(m.completedAt)}</span>
            </>
          ) : (
            <span className="rv-muted">Not completed</span>
          )}
        </div>
        <div className="rv-row">
          <strong style={{ minWidth: '5.5rem' }}>ASQ-3</strong>
          {a ? (
            <span className="rv-muted">
              {a.intervalMonths ? `${a.intervalMonths}-month questionnaire` : 'Questionnaire'} · completed {fmtDate(a.completedAt)}
            </span>
          ) : (
            <span className="rv-muted">Not completed</span>
          )}
        </div>
        {a?.domains?.length ? (
          <div style={{ marginTop: '0.5rem' }}>
            {a.domains.map((d) => (
              <div className="rv-asq" key={d.domain}>
                <span>{d.domain}</span>
                <Bar value={d.score != null ? (d.score / (d.maxScore || 60)) * 100 : 0} />
                <span className="rv-num">
                  {d.score ?? '—'}/{d.maxScore || 60}
                </span>
                <Chip zone={d.zone}>{ZONE_LABEL[d.zone] || 'Unknown'}</Chip>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <div className="rv-two">
        <Section title="Gains">
          <List items={data.highlights?.improvements} empty="No measurable gains recorded yet." />
        </Section>
        <Section title="Needs attention">
          <List items={data.highlights?.needsAttention} empty="Nothing flagged." />
        </Section>
      </div>

      <Audience a={data.audience || {}} />

      <Section title="Recommendations">
        <List items={data.recommendations} empty="No recommendations." />
      </Section>

      {data.disclaimer ? <p className="rv-disclaimer">{data.disclaimer}</p> : null}
    </div>
  );
}
