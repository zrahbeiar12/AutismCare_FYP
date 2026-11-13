const { getCurrentTime, getCurrentTimeMs } = require('../utils/time.js');
/**
 * Unified progress engine — single source of truth for therapy case progress.
 * Aggregates SessionLog (goalData + session-level scores), HomeAssignment ratings,
 * and TherapyPlan baselines/targets. Used by /api/progress-engine, analytics, progress, integration.
 */

const mongoose = require('mongoose');
const TherapyPlan = require('../models/TherapyPlan');
const TherapyCase = require('../models/TherapyCase');
const SessionLog = require('../models/SessionLog');
const { HomeAssignment } = require('../models/HomeAssignment');
const { parseResponseScore, parseScale1to5 } = require('../utils/sessionResponseScore');
const { resolveMasteryRuleFromGoal } = require('../utils/masteryPresets');

const CLINICAL_DOMAINS = ['communication', 'behavior', 'social'];

/** In-memory short TTL cache (optional perf); keyed by caseId|therapistId */
const engineCache = new Map();
const CACHE_MS = Number(process.env.PROGRESS_ENGINE_CACHE_MS || 45000);

function cacheKey(caseId, therapistId) {
  return `${String(caseId)}|${therapistId ? String(therapistId) : 'all'}`;
}

function getCached(key) {
  const row = engineCache.get(key);
  if (!row) return null;
  if (getCurrentTimeMs() - row.t > CACHE_MS) {
    engineCache.delete(key);
    return null;
  }
  return row.payload;
}

function setCached(key, payload) {
  engineCache.set(key, { t: getCurrentTimeMs(), payload });
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** 0–100 → 0–5 */
function pctToFive(p) {
  if (p == null || Number.isNaN(Number(p))) return null;
  return Math.max(0, Math.min(5, Number(p) / 20));
}

/** 1–5 rating → 0–5 scale (same numbers) */
function ratingToFive(r) {
  if (r == null || Number.isNaN(Number(r))) return null;
  return Math.max(0, Math.min(5, Number(r)));
}

/** Map plan builder domain → clinical bucket (communication | behavior | social) */
function mapPlanDomainToClinical(domainRaw) {
  const d = String(domainRaw || '').trim();
  if (d === 'Behavioral' || d === 'Behavioral (ABA)') return 'behavior';
  if (d === 'OT' || d === 'Sensory') return 'social';
  if (d === 'Speech' || d === 'AAC' || d === 'PECS') return 'communication';
  return 'communication';
}

/** Legacy analytics buckets (Speech, OT, Sensory, Behavioral) for chart backward compatibility */
function mapPlanDomainToLegacyBucket(domainRaw) {
  const d = String(domainRaw || '').trim();
  if (d === 'OT' || d === 'Occupational Therapy') return 'Occupational Therapy';
  if (d === 'Behavioral (ABA)' || d === 'Behavioral') return 'Behavioral';
  if (d === 'Sensory') return 'Sensory';
  if (d === 'Speech' || d === 'AAC' || d === 'PECS') return 'Speech';
  return 'Speech';
}

function linearSlope(y) {
  const n = y.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - xMean) * (y[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function classifyTrendThree(slope) {
  if (slope > 0.08) return 'improving';
  if (slope < -0.08) return 'declining';
  return 'stagnant';
}

const MEASUREMENT_ENUM = ['accuracy_trials', 'frequency', 'duration', 'latency', 'rating_1_5', 'score'];

/** Infer measurement type when row omits it or data disagrees with declared type. */
function inferEffectiveMeasurementType(row, goalDef) {
  if (!row || typeof row !== 'object') return goalDef?.measurementType || 'rating_1_5';
  const explicit = String(row.measurementType || '').trim();
  if (explicit && MEASUREMENT_ENUM.includes(explicit)) {
    if (explicit === 'accuracy_trials' && Number(row.trials) > 0) return explicit;
    if (explicit === 'rating_1_5' && row.rating != null) return explicit;
    if (explicit === 'frequency' && row.count != null) return explicit;
    if ((explicit === 'duration' || explicit === 'latency') && row.seconds != null) return explicit;
    if (explicit === 'score' && row.score != null) return explicit;
  }
  if (row.trials != null && Number(row.trials) > 0 && row.correct != null) return 'accuracy_trials';
  if (row.rating != null) return 'rating_1_5';
  if (row.count != null) return 'frequency';
  if (row.seconds != null) return String(goalDef?.measurementType || '').includes('latency') ? 'latency' : 'duration';
  if (row.score != null) return 'score';
  return goalDef?.measurementType || 'rating_1_5';
}

function normalizedScoreFromGoalRow(row, goalDef) {
  if (!row) return null;
  const t = inferEffectiveMeasurementType(row, goalDef);
  if ((t === 'score' || t === 'rating_1_5') && row.score != null && Number.isFinite(Number(row.score))) {
    return Math.max(0, Math.min(100, (Number(row.score) / 5) * 100));
  }
  if (t === 'accuracy_trials' && row.trials > 0) {
    return (100 * Number(row.correct)) / Number(row.trials);
  }
  if (t === 'rating_1_5' && row.rating != null) {
    return (Number(row.rating) / 5) * 100;
  }
  if (t === 'frequency' && row.count != null) {
    const tv = goalDef?.targetValue;
    if (tv != null && tv > 0) return Math.min(100, (Number(row.count) / Number(tv)) * 100);
  }
  if ((t === 'duration' || t === 'latency') && row.seconds != null) {
    const ts = goalDef?.targetSeconds;
    if (ts != null && ts > 0) return Math.min(100, (Number(row.seconds) / Number(ts)) * 100);
  }
  return null;
}

function legacySessionPct(session) {
  const scale = parseScale1to5(session.childResponse);
  if (scale != null) return (scale / 5) * 100;
  const s = parseResponseScore(session.childResponse);
  return s != null ? s : null;
}

/**
 * Resolve the primary therapy plan for clinician/parent views when multiple therapists exist.
 * Prefers plan owned by a therapist with an active TherapyCase on this case; else most recently updated.
 */
async function resolvePrimaryTherapyPlanForCase(caseId) {
  if (!mongoose.Types.ObjectId.isValid(caseId)) return null;
  const oid = new mongoose.Types.ObjectId(String(caseId));
  const plans = await TherapyPlan.find({ caseId: oid })
    .sort({ updatedAt: -1 })
    .populate('therapistId', 'firstName lastName specialization')
    .lean();
  if (!plans.length) return null;
  const activeCases = await TherapyCase.find({ caseId: oid, status: 'ACTIVE' }).select('therapistId').lean();
  const activeSet = new Set(activeCases.map((t) => String(t.therapistId)));
  const preferred = plans.find((p) => p.therapistId && activeSet.has(String(p.therapistId._id || p.therapistId)));
  return preferred || plans[0];
}

function stableGoalId(g, idx) {
  const explicit = String(g.goalId || '').trim();
  if (explicit) return explicit;
  const key = String(g.goalKey || '').trim();
  if (key) return key;
  if (g._id) return String(g._id);
  return `legacy-goal-${idx}-${String(g.title || '').slice(0, 24)}`;
}

function collectPlanGoalDefs(plan) {
  const planSafe = plan || {};
  const out = [];
  const short = Array.isArray(planSafe.shortTermGoals) ? planSafe.shortTermGoals : [];
  short.forEach((g, idx) => {
    const goalName = String(g.title || '').trim();
    if (!goalName && !g.goalKey && !g._id) return;
    const goalId = stableGoalId(g, idx);
    const matchKeys = new Set();
    if (goalName) matchKeys.add(goalName);
    if (g._id) matchKeys.add(String(g._id));
    if (g.goalKey) matchKeys.add(String(g.goalKey).trim());
    if (g.goalId) matchKeys.add(String(g.goalId).trim());
    const resolvedMr = resolveMasteryRuleFromGoal(g);
    const measurementType = g.measurement?.type || 'rating_1_5';
    const baselineVal = g.baseline?.value != null ? Number(g.baseline.value) : null;
    const targetVal = g.target?.value != null ? Number(g.target.value) : null;
    out.push({
      goalId,
      goalName: goalName || goalId,
      clinicalDomain: mapPlanDomainToClinical(g.domain),
      legacyDomain: mapPlanDomainToLegacyBucket(g.domain),
      planStatus: String(g.status || 'Active'),
      matchKeys,
      measurementType,
      baselineFive:
        baselineVal != null && Number.isFinite(baselineVal)
          ? measurementType === 'rating_1_5'
            ? Math.max(0, Math.min(5, baselineVal))
            : pctToFive(baselineVal)
          : null,
      targetFive:
        targetVal != null && Number.isFinite(targetVal)
          ? measurementType === 'rating_1_5'
            ? Math.max(0, Math.min(5, targetVal))
            : pctToFive(targetVal)
          : null,
      masteryCriteria: String(g.masteryCriteria || g.measurableCriteria || '').trim(),
      masteryRule: {
        ruleType: resolvedMr.ruleType,
        threshold: resolvedMr.threshold,
        window: resolvedMr.window,
        minSessions: resolvedMr.minSessions,
      },
      targetValue: targetVal,
      targetSeconds: null,
    });
  });

  const legacy = Array.isArray(planSafe.goals) ? planSafe.goals : [];
  legacy.forEach((g, i) => {
    if (!g || g.type === 'long-term') return;
    const goalName = String(g.title || '').trim();
    if (!goalName) return;
    const goalId = `legacy-array-${i}-${goalName}`;
    out.push({
      goalId,
      goalName,
      clinicalDomain: mapPlanDomainToClinical(g.domain),
      legacyDomain: mapPlanDomainToLegacyBucket(g.domain),
      planStatus: String(g.status || 'Active'),
      matchKeys: new Set([goalName]),
      measurementType: 'rating_1_5',
      baselineFive: null,
      targetFive: null,
      masteryCriteria: String(g.description || '').trim(),
      masteryRule: {
        ruleType: 'threshold_out_of_n_sessions',
        threshold: 80,
        window: 5,
        minSessions: 3,
      },
      targetValue: null,
      targetSeconds: null,
    });
  });
  return out;
}

function findGoalDataRow(session, goalDef) {
  const rows = Array.isArray(session.goalData) ? session.goalData : [];
  if (!rows.length) return null;
  const byGoalId = rows.find((r) => {
    const gid = String(r.goalId || '').trim();
    return gid && gid === goalDef.goalId;
  });
  if (byGoalId) return byGoalId;
  const byKey = rows.find((r) => r.goalKey && goalDef.matchKeys.has(String(r.goalKey).trim()));
  if (byKey) return byKey;
  return rows.find((r) => {
    const t = String(r.goalTitleMatch || '').trim();
    return t && goalDef.matchKeys.has(t);
  }) || null;
}

function sessionTouchesGoal(session, goalDef) {
  if (findGoalDataRow(session, goalDef)) return true;
  const gt = Array.isArray(session.goalsTargeted) ? session.goalsTargeted : [];
  return gt.some((x) => goalDef.matchKeys.has(String(x).trim()));
}

function smoothGoalSeriesPoints(points) {
  if (points.length < 2) return points;
  const vals = points.map((p) => p.scoreFive);
  const sm = movingAverage3(vals);
  return points.map((p, i) => {
    const sf = sm[i];
    return {
      ...p,
      scoreFive: Number(Number(sf).toFixed(3)),
      pct: sf * 20,
    };
  });
}

function perPointConfidence(p) {
  if (!p) return 0.45;
  if (p.dataSource === 'goalData' && !p.inferredMeasurement) return 0.88;
  if (p.dataSource === 'goalData') return 0.68;
  return 0.52;
}

/** Raw + display (optional smoothing) series with per-point provenance for explainability. */
function buildGoalSeriesDetailed(sessionsAsc, goalDef) {
  const rawPoints = [];
  for (const s of sessionsAsc) {
    if (String(s.status || 'completed') !== 'completed') continue;
    const row = findGoalDataRow(s, goalDef);
    let pct = null;
    let dataSource = 'childResponse';
    let inferredMeasurement = false;
    if (row) {
      const declared = String(row.measurementType || '').trim();
      const effective = inferEffectiveMeasurementType(row, goalDef);
      inferredMeasurement = !declared || (declared && declared !== effective);
      dataSource = 'goalData';
      pct = normalizedScoreFromGoalRow(row, goalDef);
    }
    if (pct == null) {
      const gt = Array.isArray(s.goalsTargeted) ? s.goalsTargeted : [];
      const hit = gt.some((x) => goalDef.matchKeys.has(String(x).trim()));
      if (hit) {
        pct = legacySessionPct(s);
        dataSource = 'childResponse';
        inferredMeasurement = false;
      }
    }
    if (pct == null) continue;
    rawPoints.push({
      sessionId: String(s._id),
      date: s.sessionDate ? new Date(s.sessionDate).toISOString() : null,
      scoreFive: pctToFive(pct),
      pct,
      dataSource,
      inferredMeasurement,
    });
  }

  let smoothingApplied = false;
  let displayPoints = rawPoints;
  if (rawPoints.length >= 2) {
    const vals = rawPoints.map((p) => p.scoreFive);
    const v = varianceSample(vals);
    if (v > 0.18 || (rawPoints.length <= 4 && vals.length >= 2)) {
      displayPoints = smoothGoalSeriesPoints(rawPoints);
      smoothingApplied = true;
    }
  }

  let dominantSource = 'childResponse';
  if (rawPoints.length) {
    const nG = rawPoints.filter((p) => p.dataSource === 'goalData').length;
    const ratioG = nG / rawPoints.length;
    const nInf = rawPoints.filter((p) => p.inferredMeasurement).length;
    const ratioInf = nInf / rawPoints.length;
    if (ratioInf >= 0.45) dominantSource = 'inferred';
    else if (ratioG >= 0.45) dominantSource = 'goalData';
    else dominantSource = 'childResponse';
  }

  const structuredDataRatio =
    rawPoints.length > 0 ? Number((rawPoints.filter((p) => p.dataSource === 'goalData').length / rawPoints.length).toFixed(3)) : 0;

  const timeSeries = rawPoints.map((raw, i) => ({
    date: raw.date,
    score: raw.scoreFive,
    smoothedScore:
      smoothingApplied && displayPoints[i] ? Number(displayPoints[i].scoreFive.toFixed(3)) : undefined,
    confidence: Number(perPointConfidence(raw).toFixed(2)),
  }));

  return {
    rawPoints,
    displayPoints,
    smoothingApplied,
    dominantSource,
    structuredDataRatio,
    sessionsUsed: rawPoints.length,
    timeSeries,
  };
}

function buildReasoningSummary(ctx) {
  const {
    goalName,
    dominantSource,
    sessionsUsed,
    structuredDataRatio,
    smoothingApplied,
    inferredDominant,
    trend,
    gconfLabel,
  } = ctx;
  const src =
    dominantSource === 'goalData'
      ? 'structured session goal data'
      : dominantSource === 'inferred'
        ? 'mixed sources with inferred measurement handling'
        : 'session-level responses linked to this goal';
  const smooth = smoothingApplied ? ' Short-term smoothing was applied for sparse or jumpy signals.' : '';
  const infer = inferredDominant ? ' Some rows relied on inferred measurement types.' : '';
  return `"${goalName}" reflects ${sessionsUsed} session(s); primary input: ${src}. Structured data ratio ${Math.round(structuredDataRatio * 100)}%. Trend: ${trend}. Confidence ${gconfLabel}.${smooth}${infer}`;
}

function classifyOverallTrend(improvementRate, weeklySorted) {
  if (weeklySorted && weeklySorted.length >= 3) {
    const ys = weeklySorted.map((w) => w.y);
    const slope = linearSlope(ys);
    const t = classifyTrendThree(slope);
    return t;
  }
  if (improvementRate > 0.03) return 'improving';
  if (improvementRate < -0.03) return 'declining';
  return 'stagnant';
}

function buildGoalInsights(trend, seriesScores, goalName, goalId) {
  const insights = [];
  const lastWindow = 5;
  const recent = seriesScores.slice(-lastWindow);
  if (trend === 'declining') {
    insights.push({
      severity: 'critical',
      code: 'goal_declining',
      goalId,
      message: `Regression detected for "${goalName}" (recent trajectory declining).`,
    });
  }
  if (recent.length >= 4) {
    const v = varianceSample(recent);
    if (v > 0.32) {
      insights.push({
        severity: 'warning',
        code: 'goal_high_variability',
        goalId,
        message: `Inconsistent response pattern for "${goalName}" (high variability across recent sessions).`,
      });
    }
  }
  if (trend === 'stagnant' && seriesScores.length >= 4) {
    const lastN = Math.min(5, seriesScores.length);
    const slice = seriesScores.slice(-lastN);
    const slope = linearSlope(slice);
    if (Math.abs(slope) < 0.06) {
      insights.push({
        severity: 'warning',
        code: 'goal_no_improvement_recent',
        goalId,
        message: `No improvement in last ${lastN} session(s): "${goalName}".`,
      });
    }
  }
  return insights;
}

/**
 * Per-goal confidence (0–1) from session depth, structured goalData usage, measurement consistency.
 */
function computeGoalConfidenceScore(goalDef, series, sessionsAsc) {
  const completed = (sessionsAsc || []).filter((s) => String(s.status || 'completed') === 'completed');
  let touchedSessions = 0;
  let structuredHits = 0;
  let typeAligned = 0;
  let structuredTotal = 0;
  for (const s of completed) {
    if (!sessionTouchesGoal(s, goalDef)) continue;
    touchedSessions += 1;
    const row = findGoalDataRow(s, goalDef);
    if (row) {
      structuredHits += 1;
      structuredTotal += 1;
      const inf = inferEffectiveMeasurementType(row, goalDef);
      if (inf === (goalDef.measurementType || 'rating_1_5')) typeAligned += 1;
    }
  }
  const nPoints = series.length;
  if (touchedSessions === 0 && nPoints === 0) {
    return { score: 0, label: 'low' };
  }
  let c = 0.2 * Math.min(1, nPoints / 5);
  c += 0.35 * (touchedSessions ? Math.min(1, structuredHits / Math.max(1, touchedSessions)) : 0);
  c += 0.25 * (structuredTotal ? typeAligned / Math.max(1, structuredTotal) : 0.35);
  c += 0.2 * Math.min(1, touchedSessions / 8);
  const score = Number(Math.max(0, Math.min(1, c)).toFixed(3));
  return { score, label: confidenceLabel(score) };
}

/** Display series (optionally smoothed). Backward-compatible with pre-v3 callers. */
function buildGoalSeries(sessionsAsc, goalDef) {
  return buildGoalSeriesDetailed(sessionsAsc, goalDef).displayPoints;
}

function evaluateMasteryPct(series, rule) {
  const { ruleType, threshold, window, minSessions } = rule;
  if (!series.length || series.length < minSessions) {
    return { status: 'insufficient_data', mastered: false };
  }
  const vals = series.map((p) => p.pct);
  const lastWindow = vals.slice(-window);
  if (ruleType === 'threshold_consecutive_sessions') {
    const ok = lastWindow.length >= window && lastWindow.every((v) => v >= threshold);
    return { status: ok ? 'mastered' : 'active', mastered: ok };
  }
  const avg = mean(lastWindow);
  const mastered = lastWindow.length >= minSessions && avg >= threshold;
  return {
    status: mastered ? 'mastered' : 'active',
    mastered,
    windowAvgPct: Number(avg.toFixed(2)),
  };
}

function weekMondayKey(d) {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  const day = t.getDay();
  const diff = t.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(t);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function stagnantTwoWeeks(series) {
  const withDates = (series || []).filter((p) => p.date && p.scoreFive != null);
  if (withDates.length < 3) return false;
  const now = getCurrentTimeMs();
  const cutoff = now - 14 * 24 * 60 * 60 * 1000;
  const recent = withDates.filter((p) => new Date(p.date).getTime() >= cutoff);
  const older = withDates.filter((p) => new Date(p.date).getTime() < cutoff);
  if (recent.length < 2) return false;
  const rAvg = mean(recent.map((p) => p.scoreFive));
  const oAvg = older.length ? mean(older.map((p) => p.scoreFive)) : rAvg;
  return Math.abs(rAvg - oAvg) < 0.15 && rAvg < 3;
}

/** 3-point centered moving average (edges use available neighbors). */
function movingAverage3(values) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0]];
  if (n === 2) return [values[0], values[1]];
  return values.map((_, i) => {
    const a = values[Math.max(0, i - 1)];
    const b = values[i];
    const c = values[Math.min(n - 1, i + 1)];
    return Number(((a + b + c) / 3).toFixed(2));
  });
}

const STRUCTURED_MEASUREMENT_TYPES = new Set(['accuracy_trials', 'frequency', 'duration', 'latency', 'score']);

function varianceSample(vals) {
  if (!vals.length) return Infinity;
  const m = mean(vals);
  let s = 0;
  for (const v of vals) s += (v - m) ** 2;
  return s / vals.length;
}

/** Dynamic session vs home blend: no home → 100% session; volatile home ratings → lower home weight. */
function computeAdaptiveBlendWeights(therapyScoresFive, homeScoresFive) {
  const nT = therapyScoresFive.length;
  const nH = homeScoresFive.length;
  if (nH === 0) return { wSession: 1, wHome: 0 };
  if (nT === 0) return { wSession: 0, wHome: 1 };
  const varH = varianceSample(homeScoresFive);
  let wHome = 0.22 + Math.min(0.38, nH * 0.055);
  if (varH > 0.18) wHome *= 0.72;
  if (varH > 0.32) wHome *= 0.82;
  wHome = Math.min(0.48, Math.max(0.12, wHome));
  return { wSession: Number((1 - wHome).toFixed(3)), wHome: Number(wHome.toFixed(3)) };
}

/**
 * Adaptive per-session confidence (0–1): goal rows, structure, short-window consistency, sparsity, rating-only.
 * @param {object} session
 * @param {number} idx — index in scored session list (chronological among scored)
 * @param {{ session: object, perFive: number }[]} scoredSessions
 */
function computeSessionAdaptiveConfidence(session, idx, scoredSessions) {
  const rows = Array.isArray(session.goalData) ? session.goalData : [];
  let c = 0;
  if (rows.length > 0) c += 0.4;
  const hasStructured = rows.some((r) =>
    STRUCTURED_MEASUREMENT_TYPES.has(String(r.measurementType || '').trim())
  );
  if (hasStructured) c += 0.2;

  const window = scoredSessions.slice(Math.max(0, idx - 4), idx + 1).map((x) => x.perFive);
  if (window.length >= 3) {
    const v = varianceSample(window);
    if (v < 0.12) c += 0.2;
  }

  const legacyOnly = rows.length === 0 && legacySessionPct(session) != null;
  if (legacyOnly) c -= 0.2;

  const onlyRating =
    rows.length > 0 &&
    rows.every((r) => String(r.measurementType || 'rating_1_5').trim() === 'rating_1_5');
  if (onlyRating || (rows.length === 0 && legacyOnly)) c += 0.1;

  return Math.max(0, Math.min(1, Number(c.toFixed(3))));
}

function confidenceLabel(overall) {
  if (overall > 0.7) return 'high';
  if (overall > 0.4) return 'medium';
  return 'low';
}

function sessionCompositeScoreFive(s) {
  // Treat signed sessions as completed for analytics/trends.
  const st = String(s.status || 'completed').toLowerCase();
  if (st !== 'completed' && st !== 'signed') return null;
  const rows = Array.isArray(s.goalData) ? s.goalData : [];
  const parts = rows
    .map((r) => {
      if (r.score != null) return ratingToFive(r.score);
      const pct = normalizedScoreFromGoalRow(r, {});
      return pct != null ? pctToFive(pct) : null;
    })
    .filter((v) => v != null);
  if (parts.length) return mean(parts);
  const leg = legacySessionPct(s);
  return leg != null ? pctToFive(leg) : null;
}

/** Monday-based week keys; fills empty calendar weeks between first and last; 3-point MA on forward-filled series */
function buildWeeklyTrendSeries(sessionsAsc) {
  // NOTE: Despite the name, we intentionally use a per-session-day key (YYYY-MM-DD).
  // Weekly bucketing collapses multiple sessions into one point and makes UI/tests less deterministic.
  const byWeek = new Map();
  for (const s of sessionsAsc) {
    const sf = sessionCompositeScoreFive(s);
    if (sf == null) continue;
    const d = s.sessionDate ? new Date(s.sessionDate) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    if (!key) continue;
    if (!byWeek.has(key)) byWeek.set(key, { sum: 0, n: 0 });
    const b = byWeek.get(key);
    b.sum += sf;
    b.n += 1;
  }
  const keys = Array.from(byWeek.keys()).sort();
  if (keys.length === 0) return [];

  const filled = keys.map((key) => {
    const b = byWeek.get(key);
    // Keep precision here; rounding happens at presentation time.
    const raw = b && b.n ? b.sum / b.n : null;
    return { week: key, yRaw: raw };
  });

  let last = null;
  const interpolated = filled.map((row) => {
    let v = row.yRaw;
    if (v == null && last != null) v = last;
    if (v != null) last = v;
    return { week: row.week, yRaw: row.yRaw, yFilled: v };
  });
  const nums = interpolated.map((r) => (r.yFilled != null ? r.yFilled : 0));
  const smoothed = movingAverage3(nums);
  return interpolated.map((row, idx) => ({
    week: row.week,
    score: row.yRaw != null ? row.yRaw : smoothed[idx],
    yRaw: row.yRaw,
    x: `Week ${idx + 1}`,
    y: smoothed[idx],
  }));
}

function buildPerGoalClinicalRecommendation(g) {
  if (!g) return '';
  if (g.trend === 'declining') {
    return 'Prioritize reassessment and targeted practice for this goal.';
  }
  if (g.trend === 'stagnant' && Number(g.dataPoints || 0) >= 3) {
    return 'Consider adjusting difficulty or measurement; trend is flat across recent sessions.';
  }
  if (String(g.confidenceLabel || '').toLowerCase() === 'low') {
    return 'Collect more structured goal data in upcoming sessions to firm up this signal.';
  }
  if (g.mastery === true || String(g.masteryStatus || '') === 'mastered') {
    return 'Maintain reinforcement; goal shows mastery pattern.';
  }
  return 'Continue planned intervention; signal is stable or improving.';
}

/**
 * Case-level clinical triage for dashboards (no client-side progress math).
 */
function buildClinicalDecisionLayer(ctx) {
  const { goalsPayload, smartAlerts, weakAreas, overallTrend, confidenceOverall } = ctx;
  const crit = (smartAlerts || []).filter((a) => String(a.severity || '').toLowerCase() === 'critical');
  const warn = (smartAlerts || []).some((a) => String(a.severity || '').toLowerCase() === 'warning');
  const decliningGoals = (goalsPayload || []).filter((g) => g && g.trend === 'declining').length;
  const stagnantMany = (goalsPayload || []).filter((g) => g && g.trend === 'stagnant' && Number(g.dataPoints || 0) >= 3).length;
  const co = Number(confidenceOverall) || 0;

  let overallClinicalStatus = 'on_track';
  if (crit.length > 0 || decliningGoals >= 2 || (overallTrend === 'declining' && co >= 0.35)) {
    overallClinicalStatus = 'high_concern';
  } else if (
    co < 0.4 ||
    warn ||
    overallTrend === 'declining' ||
    stagnantMany >= 2 ||
    (weakAreas || []).length >= 2
  ) {
    overallClinicalStatus = 'needs_attention';
  }

  const parts = [];
  for (const w of weakAreas || []) {
    if (parts.length >= 3) break;
    parts.push(typeof w === 'string' ? w : w.reason || '');
  }
  for (const a of smartAlerts || []) {
    if (parts.length >= 5) break;
    if (a && a.message) parts.push(a.message);
  }
  const clinicalReasoning =
    parts.filter(Boolean).join(' ').slice(0, 520) || 'No major clinical drivers flagged by the progress engine.';

  let clinicalRecommendation =
    'Maintain current therapy cadence and home practice; re-check progress in upcoming sessions.';
  if (overallClinicalStatus === 'high_concern') {
    clinicalRecommendation =
      'Schedule a focused case review; align on plan changes, regression drivers, and family communication.';
  } else if (overallClinicalStatus === 'needs_attention') {
    clinicalRecommendation =
      'Review therapist session notes and adherence; clarify measurement and short-term targets for drifting goals.';
  }

  return { overallClinicalStatus, clinicalReasoning, clinicalRecommendation };
}

/**
 * Core synchronous build from already-loaded documents.
 * @param {{ caseId: string, plan: object|null, sessions: object[], assignments: object[] }} input
 */
function buildProgressEnginePayload(input) {
  const { caseId, plan, sessions, assignments } = input;
  const sessionsAsc = [...(sessions || [])].sort((a, b) => new Date(a.sessionDate) - new Date(b.sessionDate));
  const assigns = assignments || [];
  const goalDefs = collectPlanGoalDefs(plan);

  const scoredSessions = [];
  for (const s of sessionsAsc) {
    const st = String(s.status || 'completed').toLowerCase();
    if (st !== 'completed' && st !== 'signed') continue;
    const rows = Array.isArray(s.goalData) ? s.goalData : [];
    const rowScores = rows
      .map((r) => {
        if (r.score != null) return ratingToFive(r.score);
        const pct = normalizedScoreFromGoalRow(r, {});
        return pct != null ? pctToFive(pct) : null;
      })
      .filter((v) => v != null);
    let perFive = null;
    if (rowScores.length) {
      perFive = mean(rowScores);
    } else {
      const leg = legacySessionPct(s);
      if (leg != null) perFive = pctToFive(leg);
    }
    if (perFive == null) continue;
    scoredSessions.push({ session: s, perFive });
  }
  const therapyScoresFive = scoredSessions.map((x) => x.perFive);
  const sessionConfidences = scoredSessions.map((row, idx) =>
    computeSessionAdaptiveConfidence(row.session, idx, scoredSessions)
  );

  const homeRatings = assigns
    .map((a) => a.therapistFeedback?.rating)
    .filter((r) => r != null && Number.isFinite(Number(r)));
  const homeScoresFive = homeRatings.map((r) => ratingToFive(r));

  const therapyScore = therapyScoresFive.length ? mean(therapyScoresFive) : null;
  const homeScore = homeScoresFive.length ? mean(homeScoresFive) : null;

  const blend = computeAdaptiveBlendWeights(therapyScoresFive, homeScoresFive);
  let rawBlendScore = 0;
  if (therapyScore != null && homeScore != null) {
    rawBlendScore = therapyScore * blend.wSession + homeScore * blend.wHome;
  } else if (therapyScore != null) {
    rawBlendScore = therapyScore;
  } else if (homeScore != null) {
    rawBlendScore = homeScore;
  }

  let confidenceOverall = 0;
  if (sessionConfidences.length > 0) {
    confidenceOverall = Number(mean(sessionConfidences).toFixed(3));
  } else if (homeScoresFive.length > 0 && therapyScoresFive.length === 0) {
    confidenceOverall = 0.55;
  }

  // Headline score = the child's performance level (0–5). Data confidence is reported separately (`confidence`)
  // rather than multiplied in: a confident-looking low score for a child performing well misled every audience.
  const finalScore = Number(rawBlendScore.toFixed(2));
  const confidenceAdjustedScore = Number((rawBlendScore * confidenceOverall).toFixed(2));
  const confidence = {
    overall: confidenceOverall,
    label: confidenceLabel(confidenceOverall),
  };

  const totalAssignments = assigns.length;
  const completedAssignments = assigns.filter((a) => String(a.status || '') === 'completed').length;
  /** No assignments ⇒ unknown adherence — do not default to 100% (misleading for parents). */
  const consistency = totalAssignments > 0 ? completedAssignments / totalAssignments : null;

  const weeklySorted = buildWeeklyTrendSeries(sessionsAsc);

  let improvementRate = 0;
  if (weeklySorted.length >= 2) {
    const prevAvg = weeklySorted[weeklySorted.length - 2].y;
    const curAvg = weeklySorted[weeklySorted.length - 1].y;
    improvementRate = prevAvg > 0 ? (curAvg - prevAvg) / prevAvg : curAvg > 0 ? 1 : 0;
    improvementRate = Number(improvementRate.toFixed(4));
  }

  const goalSeriesById = new Map();

  const goalsPayload = goalDefs.map((def) => {
    const detail = buildGoalSeriesDetailed(sessionsAsc, def);
    const series = detail.displayPoints;
    goalSeriesById.set(def.goalId, series);

    const scoresFive = series.map((p) => p.scoreFive).filter((v) => v != null);
    const current = scoresFive.length ? Number(mean(scoresFive).toFixed(2)) : null;
    const recent = scoresFive.slice(-3);
    const currentRecent = recent.length ? Number(mean(recent).toFixed(2)) : current;
    const slopeSeries = scoresFive.slice(-Math.min(5, scoresFive.length));
    const slope = slopeSeries.length >= 2 ? linearSlope(slopeSeries) : 0;
    const trend = classifyTrendThree(slope);
    const mastery = evaluateMasteryPct(
      series.map((p) => ({ pct: p.pct, date: p.date })),
      def.masteryRule
    );
    let masteryStatus = mastery.status;
    if (String(def.planStatus).toLowerCase() === 'achieved') masteryStatus = 'mastered';

    const linkedAssignments = assigns.filter((a) => {
      const gk = String(a.goalKey || '').trim();
      return gk && def.matchKeys.has(gk);
    });
    const assignRatings = linkedAssignments
      .map((a) => a.therapistFeedback?.rating)
      .filter((r) => r != null && Number.isFinite(Number(r)));
    const assignmentRatingAvg =
      assignRatings.length > 0
        ? Number(mean(assignRatings.map((r) => ratingToFive(r))).toFixed(2))
        : null;

    const gconf = computeGoalConfidenceScore(def, series, sessionsAsc);
    const mastered = mastery.mastered === true || masteryStatus === 'mastered';
    const progressPercent =
      currentRecent != null
        ? Number(((currentRecent / 5) * 100).toFixed(2))
        : mastered
          ? 100
          : null;

    const inferredAny = detail.rawPoints.some((p) => p.inferredMeasurement);
    const explanation = {
      dataSource: detail.dominantSource,
      sessionsUsed: detail.sessionsUsed,
      structuredDataRatio: detail.structuredDataRatio,
      smoothingApplied: detail.smoothingApplied,
      inferredMeasurement: inferredAny,
    };

    const reasoningSummary = buildReasoningSummary({
      goalName: def.goalName,
      dominantSource: detail.dominantSource,
      sessionsUsed: detail.sessionsUsed,
      structuredDataRatio: detail.structuredDataRatio,
      smoothingApplied: detail.smoothingApplied,
      inferredDominant: detail.dominantSource === 'inferred',
      trend,
      gconfLabel: gconf.label,
    });

    const goalInsights = buildGoalInsights(trend, scoresFive, def.goalName, def.goalId);
    const limitedDataUi = Boolean(gconf.score < 0.4);

    return {
      goalId: def.goalId,
      domain: def.clinicalDomain,
      legacyDomain: def.legacyDomain,
      baseline: def.baselineFive,
      current: currentRecent,
      target: def.targetFive,
      trend,
      masteryStatus,
      mastery: mastered,
      goalName: def.goalName,
      measurementType: def.measurementType,
      dataPoints: series.length,
      linkedAssignmentsCount: linkedAssignments.length,
      assignmentRatingAvg,
      confidenceScore: gconf.score,
      confidenceLabel: gconf.label,
      limitedDataUi,
      progressPercent,
      explanation,
      reasoningSummary,
      timeSeries: detail.timeSeries,
      goalInsights,
    };
  });

  const domainAgg = {};
  for (const name of CLINICAL_DOMAINS) {
    domainAgg[name] = { scores: [], slopes: [] };
  }
  goalsPayload.forEach((g) => {
    if (!domainAgg[g.domain]) return;
    if (g.current != null) domainAgg[g.domain].scores.push(g.current);
  });
  goalDefs.forEach((def) => {
    const series = goalSeriesById.get(def.goalId) || [];
    const scoresFive = series.map((p) => p.scoreFive).filter((v) => v != null);
    const slopeSeries = scoresFive.slice(-Math.min(5, scoresFive.length));
    const slopeSeriesSlope = slopeSeries.length >= 2 ? linearSlope(slopeSeries) : 0;
    const dom = def.clinicalDomain;
    if (domainAgg[dom]) domainAgg[dom].slopes.push(slopeSeriesSlope);
  });

  const domainGoalConf = {};
  for (const name of CLINICAL_DOMAINS) domainGoalConf[name] = [];
  goalsPayload.forEach((g) => {
    if (domainGoalConf[g.domain]) domainGoalConf[g.domain].push(Number(g.confidenceScore) || 0);
  });

  const domains = CLINICAL_DOMAINS.map((name) => {
    const { scores, slopes } = domainAgg[name];
    const score = scores.length ? Number(mean(scores).toFixed(2)) : 0;
    const domSlope = slopes.length ? mean(slopes) : 0;
    const status = classifyTrendThree(domSlope);
    const trend = classifyTrendThree(domSlope);
    const confArr = domainGoalConf[name] || [];
    const confidenceScore = confArr.length ? Number(mean(confArr).toFixed(3)) : 0;
    return {
      name,
      score,
      status,
      trend,
      confidenceScore,
      confidenceLabel: confidenceLabel(confidenceScore),
    };
  });

  const weakAreas = [];
  goalsPayload.forEach((g) => {
    if (g.trend === 'declining' || (g.current != null && g.current < 2)) {
      weakAreas.push({ type: 'goal', goalId: g.goalId, reason: `Goal "${g.goalName}" trend: ${g.trend}` });
    }
  });
  if (consistency != null && consistency < 0.35 && totalAssignments >= 3) {
    weakAreas.push({ type: 'compliance', reason: 'Low home assignment completion rate' });
  }

  const activityLinked = assigns.filter((a) => a.activityId || a.sourceActivityId);
  const activityCompleted = activityLinked.filter((a) => String(a.status || '') === 'completed').length;
  const activityCompletionRate =
    activityLinked.length > 0 ? Number((activityCompleted / activityLinked.length).toFixed(3)) : null;

  const overallTrend = classifyOverallTrend(improvementRate, weeklySorted);
  const shortFive = therapyScoresFive.slice(-Math.min(5, therapyScoresFive.length));
  const shortTermTrend =
    shortFive.length >= 2 ? classifyTrendThree(linearSlope(shortFive)) : 'stagnant';
  const longTermTrend = overallTrend;
  const overallExplanation = {
    sessionWeight: blend.wSession,
    homeWeight: blend.wHome,
    confidenceScore: confidenceOverall,
    dataQuality: confidence.label,
  };
  const domainScores = domains.map((d) => ({
    name: d.name,
    score: d.score,
    confidence: d.confidenceScore,
  }));

  const smartAlertsDraft = buildSmartAlerts({
    goalsPayload,
    consistency,
    totalAssignments,
    goalSeriesById,
    therapyScore,
    homeScore,
    sessionsAsc,
    weeklySorted,
    confidenceOverall,
    hasProgressSignals: therapyScoresFive.length > 0 || homeScoresFive.length > 0,
  });

  const clinicalLayer = buildClinicalDecisionLayer({
    goalsPayload,
    smartAlerts: smartAlertsDraft,
    weakAreas,
    overallTrend,
    confidenceOverall,
  });

  const goalsWithClinical = goalsPayload.map((g) => ({
    ...g,
    clinicalRecommendation: buildPerGoalClinicalRecommendation(g),
  }));

  const smartAlertsSorted = sortSmartAlertsBySeverity(smartAlertsDraft);

  return {
    caseId: String(caseId),
    engineVersion: 3,
    overallScore: finalScore,
    confidenceAdjustedScore,
    rawBlendScore: Number(rawBlendScore.toFixed(3)),
    confidence,
    overallTrend,
    shortTermTrend,
    longTermTrend,
    overallConfidence: confidenceOverall,
    overallExplanation,
    overallClinicalStatus: clinicalLayer.overallClinicalStatus,
    clinicalReasoning: clinicalLayer.clinicalReasoning,
    clinicalRecommendation: clinicalLayer.clinicalRecommendation,
    domainScores,
    improvementRate,
    consistency: consistency != null ? Number(consistency.toFixed(3)) : null,
    activityCompletionRate,
    domains,
    goals: goalsWithClinical,
    weeklyTrend: weeklySorted,
    weakAreas,
    smartAlerts: smartAlertsSorted,
    sessionInsights: buildSessionInsights(sessionsAsc, goalDefs),
    _meta: {
      blendingWeights: blend,
      therapyScoreAvg: therapyScore != null ? Number(therapyScore.toFixed(2)) : null,
      homeScoreAvg: homeScore != null ? Number(homeScore.toFixed(2)) : null,
      sessionsCounted: therapyScoresFive.length,
      homeRatingsCounted: homeScoresFive.length,
      totalAssignments,
    },
  };
}

function severityRank(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical' || s === 'error' || s === 'danger') return 0;
  if (s === 'warning') return 1;
  return 2;
}

function sortSmartAlertsBySeverity(alerts) {
  return [...(alerts || [])].sort((a, b) => {
    const d = severityRank(a.severity) - severityRank(b.severity);
    if (d !== 0) return d;
    return String(a.code || '').localeCompare(String(b.code || ''));
  });
}

function buildSmartAlerts(ctx) {
  const {
    goalsPayload,
    consistency,
    totalAssignments,
    goalSeriesById,
    therapyScore,
    homeScore,
    sessionsAsc,
    weeklySorted,
    confidenceOverall,
    hasProgressSignals,
  } = ctx;
  const alerts = [];

  if (hasProgressSignals && confidenceOverall < 0.4) {
    alerts.push({
      severity: 'warning',
      code: 'low_confidence_overall',
      message: 'Low confidence: insufficient or inconsistent data',
    });
  }

  for (const g of goalsPayload) {
    const series = goalSeriesById.get(g.goalId) || [];
    if (g.trend === 'stagnant' && g.dataPoints >= 2 && stagnantTwoWeeks(series)) {
      alerts.push({ severity: 'warning', code: 'goal_stagnant', message: `Goal stagnant for 2+ weeks: ${g.goalName}` });
    }
    if (g.explanation && g.explanation.structuredDataRatio < 0.35 && g.dataPoints >= 2) {
      alerts.push({
        severity: 'info',
        code: 'inferred_progress_heavy',
        goalId: g.goalId,
        message: `Progress based mostly on inferred data: ${g.goalName}`,
      });
    }
    if (Array.isArray(g.goalInsights)) {
      for (const ins of g.goalInsights) {
        alerts.push({
          severity: ins.severity,
          code: ins.code,
          goalId: ins.goalId,
          message: ins.message,
        });
      }
    }
  }
  if (consistency != null && totalAssignments >= 3 && consistency < 0.4) {
    alerts.push({ severity: 'warning', code: 'low_assignment_completion', message: 'Low home assignment completion' });
  }
  if (consistency != null && totalAssignments >= 2 && consistency < 0.5) {
    alerts.push({ severity: 'warning', code: 'low_adherence', message: 'Low activity adherence (home completion under 50%)' });
  }

  const completed = (sessionsAsc || []).filter((s) => String(s.status || '') === 'completed');
  const now = getCurrentTimeMs();
  const twoWeeks = 14 * 24 * 60 * 60 * 1000;
  const recentSess = completed.filter((s) => s.sessionDate && now - new Date(s.sessionDate).getTime() <= twoWeeks);
  const olderSess = completed.filter((s) => s.sessionDate && now - new Date(s.sessionDate).getTime() > twoWeeks);
  const avgFive = (arr) => {
    const v = arr.map((s) => sessionCompositeScoreFive(s)).filter((x) => x != null);
    return v.length ? mean(v) : null;
  };
  const rAvg = avgFive(recentSess);
  const oAvg = avgFive(olderSess);
  if (rAvg != null && oAvg != null && oAvg > 0.2 && rAvg < oAvg * 0.8) {
    alerts.push({
      severity: 'critical',
      code: 'regression',
      message: 'Child regression detected: average session performance dropped over 20% vs prior period',
    });
  }

  if (completed.length >= 10) {
    const recent10 = completed.slice(-10);
    const first5 = recent10.slice(0, 5);
    const last5 = recent10.slice(-5);
    const a1 = avgFive(first5);
    const a2 = avgFive(last5);
    if (a1 != null && a2 != null && a2 <= a1 * 0.98) {
      alerts.push({
        severity: 'warning',
        code: 'ineffective_therapy',
        message: 'Therapy may be ineffective: recent sessions are not outperforming earlier block averages',
      });
    }
  }

  if (therapyScore != null && homeScore != null && therapyScore - homeScore >= 1.0) {
    alerts.push({
      severity: 'warning',
      code: 'home_clinic_gap',
      message: 'Low home reinforcement: clinic session scores are stronger than home program ratings',
    });
  }

  if (weeklySorted && weeklySorted.length >= 3) {
    const ys = weeklySorted.map((w) => w.y);
    const slope = linearSlope(ys);
    if (slope < -0.06) {
      alerts.push({ severity: 'warning', code: 'weekly_decline', message: 'Weekly composite trend is declining' });
    }
  }

  return alerts;
}

function goalScoreFiveForSession(session, def) {
  const row = findGoalDataRow(session, def);
  if (row) {
    const pct = normalizedScoreFromGoalRow(row, def);
    return pct != null ? pctToFive(pct) : null;
  }
  const hit = (session.goalsTargeted || []).some((t) => def.matchKeys.has(String(t).trim()));
  if (hit) {
    const leg = legacySessionPct(session);
    return leg != null ? pctToFive(leg) : null;
  }
  return null;
}

function buildSessionInsights(sessionsAsc, goalDefs) {
  const completed = sessionsAsc.filter((s) => String(s.status || '') === 'completed');
  const last8 = completed.slice(-8);
  const prevScoreByGoal = new Map();
  const out = [];
  for (const s of last8) {
    const goalsImpacted = [];
    for (const def of goalDefs) {
      const row = findGoalDataRow(s, def);
      const touched = Boolean(row) || (s.goalsTargeted || []).some((t) => def.matchKeys.has(String(t).trim()));
      if (!touched) continue;
      const cur = goalScoreFiveForSession(s, def);
      if (cur == null) {
        goalsImpacted.push({ goalId: def.goalId, goalName: def.goalName, scoreChange: null, score: null });
        continue;
      }
      const prev = prevScoreByGoal.has(def.goalId) ? prevScoreByGoal.get(def.goalId) : null;
      prevScoreByGoal.set(def.goalId, cur);
      goalsImpacted.push({
        goalId: def.goalId,
        goalName: def.goalName,
        scoreChange: prev != null ? Number((cur - prev).toFixed(2)) : null,
        score: Number(cur.toFixed(2)),
      });
    }
    out.push({
      sessionId: String(s._id),
      sessionDate: s.sessionDate,
      goalsImpacted,
      notePreview: String(s.notes || '').slice(0, 160),
    });
  }
  return out.slice(-5);
}

/**
 * Canonical inputs for a case's progress, shared by every role (parent, clinician, therapist) and by reports.
 * Uses the primary therapy plan and ONLY that plan's therapist's sessions + home assignments, so the case-wide
 * figures are identical to what the primary therapist sees in their own (therapist-scoped) views.
 * Sessions of every status are passed: the engine scores completed/signed ones and uses the rest for attendance.
 * @returns {Promise<{ plan: object|null, therapistId: string|null, sessions: object[], assignments: object[] }>}
 */
async function loadCaseProgressInputs(caseId) {
  if (!mongoose.Types.ObjectId.isValid(caseId)) return { plan: null, therapistId: null, sessions: [], assignments: [] };
  const oid = new mongoose.Types.ObjectId(String(caseId));
  const plan = await resolvePrimaryTherapyPlanForCase(caseId);
  const ownerRaw = plan?.therapistId?._id || plan?.therapistId || null;
  const owner = ownerRaw && mongoose.Types.ObjectId.isValid(String(ownerRaw)) ? new mongoose.Types.ObjectId(String(ownerRaw)) : null;
  const scope = owner ? { caseId: oid, therapistId: owner } : { caseId: oid };
  const [sessions, assignments] = await Promise.all([
    SessionLog.find(scope).sort({ sessionDate: 1 }).lean(),
    HomeAssignment.find(scope).lean(),
  ]);
  return { plan, therapistId: owner ? String(owner) : null, sessions, assignments };
}

/** 0–5 engine score → whole-number percent. The one conversion every screen and report uses. */
function fiveToPct(v) {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return null;
  return Math.round(Math.min(5, Math.max(0, n)) / 5 * 100);
}

/**
 * Load data and compute engine (async). Uses optional therapist filter.
 */
async function computeProgressEngineForCase(caseId, options = {}) {
  const { therapistId, useCache = true } = options;
  if (!mongoose.Types.ObjectId.isValid(caseId)) {
    return { success: false, message: 'Invalid caseId', data: null };
  }
  const oid = new mongoose.Types.ObjectId(String(caseId));
  const key = cacheKey(caseId, therapistId);
  if (useCache) {
    const hit = getCached(key);
    if (hit) return { success: true, data: hit, cached: true };
  }

  let plan;
  let sessions;
  let assigns;

  if (therapistId && mongoose.Types.ObjectId.isValid(String(therapistId))) {
    const tid = new mongoose.Types.ObjectId(String(therapistId));
    [plan, sessions, assigns] = await Promise.all([
      TherapyPlan.findOne({ caseId: oid, therapistId: tid }).lean(),
      SessionLog.find({ caseId: oid, therapistId: tid }).lean(),
      HomeAssignment.find({ caseId: oid, therapistId: tid }).lean(),
    ]);
  } else {
    ({ plan, sessions, assignments: assigns } = await loadCaseProgressInputs(caseId));
  }

  const data = buildProgressEnginePayload({
    caseId: String(caseId),
    plan,
    sessions,
    assignments: assigns,
  });
  if (useCache) setCached(key, data);
  return { success: true, data, cached: false };
}

module.exports = {
  CLINICAL_DOMAINS,
  mapPlanDomainToClinical,
  mapPlanDomainToLegacyBucket,
  resolvePrimaryTherapyPlanForCase,
  loadCaseProgressInputs,
  fiveToPct,
  buildProgressEnginePayload,
  computeProgressEngineForCase,
  collectPlanGoalDefs,
  buildGoalSeries,
  pctToFive,
  invalidateProgressEngineCache(caseId) {
    const prefix = `${String(caseId)}|`;
    for (const k of engineCache.keys()) {
      if (k.startsWith(prefix)) engineCache.delete(k);
    }
  },
};
