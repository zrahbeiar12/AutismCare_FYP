const { getCurrentTime, getCurrentTimeMs } = require('../utils/time.js');
/**
 * Shared analytics aggregation for a case (SessionLog + TherapyPlan + HomeAssignment).
 * Used by GET /api/analytics/:caseId and therapy report generation — keep outputs in sync.
 */
const { parseResponseScore, parseScale1to5 } = require('../utils/sessionResponseScore');

const DOMAIN_BUCKETS = ['Speech', 'OT', 'Sensory', 'Behavioral'];

function mapPlanDomainToBucket(domainRaw) {
  const d = String(domainRaw || '').trim();
  if (d === 'OT') return 'OT';
  if (d === 'Behavioral (ABA)' || d === 'Behavioral') return 'Behavioral';
  if (d === 'Sensory') return 'Sensory';
  if (d === 'Speech' || d === 'AAC' || d === 'PECS') return 'Speech';
  return 'Speech';
}

function sessionResponseSuccessful(childResponse) {
  const scale = parseScale1to5(childResponse);
  if (scale != null) return scale >= 3;
  const score = parseResponseScore(childResponse);
  if (score == null) return false;
  return score >= 60;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function safeIsoFromSessionDate(d) {
  if (d == null) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function trendLabel(lastAvg, prevAvg) {
  if (prevAvg === 0 && lastAvg === 0) return 'stable';
  const diff = lastAvg - prevAvg;
  if (diff > 5) return 'improving';
  if (diff < -5) return 'declining';
  return 'stable';
}

function collectGoalsFromPlan(plan) {
  const out = [];
  const short = Array.isArray(plan?.shortTermGoals) ? plan.shortTermGoals : [];
  for (const g of short) {
    const goalId = g._id ? String(g._id) : '';
    const goalName = String(g.title || '').trim();
    if (!goalName && !goalId) continue;
    const id = goalId || `title:${goalName}`;
    const matchKeys = new Set();
    if (goalName) matchKeys.add(goalName);
    if (goalId) matchKeys.add(goalId);
    out.push({
      goalId: id,
      goalName: goalName || id,
      domain: mapPlanDomainToBucket(g.domain),
      status: String(g.status || 'Active'),
      matchKeys,
      reviewDate: g.reviewDate ? new Date(g.reviewDate) : null,
    });
  }
  const legacy = Array.isArray(plan?.goals) ? plan.goals : [];
  for (let i = 0; i < legacy.length; i++) {
    const g = legacy[i];
    if (g && g.type === 'long-term') continue;
    const goalName = String(g?.title || '').trim();
    if (!goalName) continue;
    const id = `legacy-${i}-${goalName}`;
    out.push({
      goalId: id,
      goalName,
      domain: mapPlanDomainToBucket(g.domain),
      status: String(g.status || 'Active'),
      matchKeys: new Set([goalName]),
      reviewDate: null,
    });
  }
  return out;
}

function sessionsForGoal(sessionsSortedAsc, matchKeys) {
  return sessionsSortedAsc.filter((s) => {
    const gt = Array.isArray(s.goalsTargeted) ? s.goalsTargeted : [];
    return gt.some((x) => matchKeys.has(String(x).trim()));
  });
}

function sessionsForDomain(sessionsSortedAsc, domainGoals) {
  const keys = new Set();
  for (const g of domainGoals) {
    g.matchKeys.forEach((k) => keys.add(k));
  }
  return sessionsSortedAsc.filter((s) => {
    const gt = Array.isArray(s.goalsTargeted) ? s.goalsTargeted : [];
    return gt.some((x) => keys.has(String(x).trim()));
  });
}

function scoresForSessions(sessions) {
  return sessions
    .map((s) => parseResponseScore(s.childResponse))
    .filter((v) => typeof v === 'number' && !Number.isNaN(v));
}

function domainTrend(sessionsSortedAsc, domainGoals) {
  const rel = sessionsForDomain(sessionsSortedAsc, domainGoals);
  const scores = scoresForSessions(rel);
  if (scores.length < 2) return 'stable';
  const last3 = scores.slice(-3);
  const prev3 = scores.length >= 6 ? scores.slice(-6, -3) : scores.slice(0, Math.max(0, scores.length - 3));
  const lastAvg = mean(last3);
  const prevAvg = prev3.length ? mean(prev3) : lastAvg;
  return trendLabel(lastAvg, prevAvg);
}

function legacyEngineDomainToBucket(legacyDomain) {
  const d = String(legacyDomain || '');
  if (d.includes('Occupational')) return 'OT';
  if (d === 'Behavioral') return 'Behavioral';
  if (d === 'Sensory') return 'Sensory';
  return 'Speech';
}

function planStatusForGoalName(planSafe, goalName) {
  const short = Array.isArray(planSafe?.shortTermGoals) ? planSafe.shortTermGoals : [];
  const hit = short.find((g) => String(g?.title || '').trim() === String(goalName || '').trim());
  if (hit) return String(hit.status || 'Active');
  const leg = Array.isArray(planSafe?.goals) ? planSafe.goals : [];
  const h2 = leg.find((g) => g && g.type !== 'long-term' && String(g?.title || '').trim() === String(goalName || '').trim());
  return h2 ? String(h2.status || 'Active') : 'Active';
}

function sessionTrendFromEngineWeekly(weekly) {
  return (weekly || [])
    .map((w) => ({
      date: w.week ? String(w.week) : null,
      childResponse: w.y != null ? Math.round(Number(w.y) * 20) : null,
    }))
    .filter((row) => row.date);
}

function buildGoalProgressFromEngine(progressEngine, planSafe) {
  const goals = Array.isArray(progressEngine?.goals) ? progressEngine.goals : [];
  return goals.map((g) => ({
    goalId: g.goalId,
    goalName: g.goalName,
    domain: legacyEngineDomainToBucket(g.legacyDomain),
    progressPercent:
      g.progressPercent != null
        ? Number(g.progressPercent)
        : g.mastery === true
          ? 100
          : 0,
    status: g.mastery === true ? 'Achieved' : planStatusForGoalName(planSafe, g.goalName),
    trend: g.trend,
    confidenceScore: g.confidenceScore,
    confidenceLabel: g.confidenceLabel,
    currentFive: g.current,
  }));
}

function buildDomainProgressFromEngineGoals(goalProgress) {
  return DOMAIN_BUCKETS.map((bucket) => {
    const gp = goalProgress.filter((x) => x.domain === bucket);
    const avg =
      gp.length > 0 ? Number((gp.reduce((s, x) => s + Number(x.progressPercent || 0), 0) / gp.length).toFixed(2)) : 0;
    const trends = gp.map((x) => x.trend);
    const trend = trends.includes('declining') ? 'declining' : trends.includes('improving') ? 'improving' : 'stable';
    const confs = gp.map((x) => Number(x.confidenceScore) || 0).filter((n) => n > 0);
    const confidenceScore = confs.length ? Number(mean(confs).toFixed(3)) : 0;
    const confidenceLabel = confidenceScore > 0.7 ? 'high' : confidenceScore > 0.4 ? 'medium' : 'low';
    return {
      domain: bucket,
      progressPercent: avg,
      trend,
      confidenceScore,
      confidenceLabel,
    };
  });
}

/**
 * @param {{ plan: object|null, sessions: object[], assignments: object[] }} params
 * @param {object|null} [progressEngine] — when sessions exist, pass engine so goal/domain/overall align with progressEngine.js
 * @returns {object} Same shape as GET /api/analytics/:caseId `data`
 */
function buildCaseAnalyticsSnapshot({ plan, sessions, assignments }, progressEngine = null) {
  const planSafe = plan || {};
  const sessionsAsc = [...sessions].sort((a, b) => new Date(a.sessionDate) - new Date(b.sessionDate));
  const goals = collectGoalsFromPlan(planSafe);
  const sessionsLen = sessionsAsc.length;

  let goalProgress;
  let overallProgress;
  let domainProgress;
  let sessionTrend;

  const useEngine =
    progressEngine &&
    sessionsLen > 0 &&
    Array.isArray(progressEngine.goals) &&
    progressEngine.goals.length > 0;

  if (useEngine) {
    goalProgress = buildGoalProgressFromEngine(progressEngine, planSafe);
    overallProgress =
      progressEngine.overallScore != null
        ? fiveToPct(progressEngine.overallScore)
        : 0;
    domainProgress = buildDomainProgressFromEngineGoals(goalProgress);
    sessionTrend = sessionTrendFromEngineWeekly(progressEngine.weeklyTrend);
  } else {
    goalProgress = goals.map((g) => {
      const rel = sessionsForGoal(sessionsAsc, g.matchKeys);
      const totalSessions = rel.length;
      let successfulSessions = 0;
      for (const s of rel) {
        if (sessionResponseSuccessful(s.childResponse)) successfulSessions += 1;
      }
      const progressPercent =
        totalSessions > 0 ? Number(((successfulSessions / totalSessions) * 100).toFixed(2)) : 0;
      return {
        goalId: g.goalId,
        goalName: g.goalName,
        domain: g.domain,
        progressPercent,
        status: g.status,
      };
    });

    overallProgress =
      goalProgress.length > 0
        ? Number(
            (goalProgress.reduce((sum, x) => sum + x.progressPercent, 0) / goalProgress.length).toFixed(2)
          )
        : 0;

    domainProgress = DOMAIN_BUCKETS.map((bucket) => {
      const dg = goals.filter((g) => g.domain === bucket);
      const gp = goalProgress.filter((x) => x.domain === bucket);
      const avg =
        gp.length > 0 ? Number((gp.reduce((s, x) => s + x.progressPercent, 0) / gp.length).toFixed(2)) : 0;
      const trend = domainTrend(sessionsAsc, dg);
      return {
        domain: bucket,
        progressPercent: avg,
        trend,
        confidenceScore: 0,
        confidenceLabel: 'low',
      };
    });

    sessionTrend = sessionsAsc
      .map((s) => {
        const score = parseResponseScore(s.childResponse);
        const date = safeIsoFromSessionDate(s.sessionDate);
        return {
          date,
          childResponse: score != null ? Math.round(score) : null,
        };
      })
      .filter((row) => row.date);
  }

  const activityMap = new Map();
  for (const s of sessionsAsc) {
    const acts = Array.isArray(s.activitiesUsed) ? s.activitiesUsed : [];
    const score = parseResponseScore(s.childResponse);
    for (const raw of acts) {
      const name = String(raw || '').trim();
      if (!name) continue;
      if (!activityMap.has(name)) {
        activityMap.set(name, { scores: [], sessions: new Set() });
      }
      const entry = activityMap.get(name);
      entry.sessions.add(String(s._id));
      if (score != null) entry.scores.push(score);
    }
  }
  const activityEffectiveness = Array.from(activityMap.entries()).map(([activityName, v]) => ({
    activityName,
    avgChildResponse: v.scores.length ? Number(mean(v.scores).toFixed(2)) : null,
    usageCount: v.sessions.size,
  }));
  activityEffectiveness.sort((a, b) => b.usageCount - a.usageCount);

  const totalA = assignments.length;
  let pending = 0;
  let submitted = 0;
  let reviewed = 0;
  let completed = 0;
  for (const a of assignments) {
    const st = String(a.status || '');
    if (st === 'pending') pending += 1;
    else if (st === 'submitted') submitted += 1;
    else if (st === 'reviewed') reviewed += 1;
    else if (st === 'completed') completed += 1;
  }
  const submittedBucket = submitted + reviewed;
  const pct = (n) => (totalA > 0 ? Number(((n / totalA) * 100).toFixed(2)) : 0);
  const assignmentStats = {
    total: totalA,
    pending,
    submitted: submittedBucket,
    completed,
    percentages: {
      pending: pct(pending),
      submitted: pct(submittedBucket),
      completed: pct(completed),
    },
  };

  const now = getCurrentTime();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let latestReview = null;
  for (const g of goals) {
    if (g.reviewDate && (!latestReview || g.reviewDate > latestReview)) latestReview = g.reviewDate;
  }
  const planUpdated = planSafe?.updatedAt ? new Date(planSafe.updatedAt) : null;
  const lastTouch = latestReview || planUpdated;
  const reviewRequired = !lastTouch || lastTouch < cutoff;
  const reviewAlert = {
    reviewRequired,
    message: reviewRequired ? 'Review goals for this child' : '',
  };

  return {
    overallProgress,
    goalProgress,
    domainProgress,
    sessionTrend,
    activityEffectiveness,
    assignmentStats,
    reviewAlert,
  };
}

const { buildStakeholderAnalyticsBlock } = require('./caseAnalyticsV2');
const { buildProgressEnginePayload, fiveToPct } = require('./progressEngine');

/**
 * Legacy chart fields + stakeholder KPI block + unified progress engine payload.
 * @param {{ plan: object|null, sessions: object[], assignments: object[] }} params
 * @param {object} [precomputedEngine] — optional; if omitted, engine is built from the same inputs.
 */
function buildUnifiedCaseAnalytics(params, precomputedEngine = undefined) {
  const stakeholder = buildStakeholderAnalyticsBlock(params);
  const cid =
    params.plan?.caseId ||
    params.sessions?.[0]?.caseId ||
    params.assignments?.[0]?.caseId ||
    '';
  const progressEngine =
    precomputedEngine !== undefined
      ? precomputedEngine
      : buildProgressEnginePayload({
          caseId: String(cid),
          plan: params.plan,
          sessions: params.sessions,
          assignments: params.assignments || [],
        });
  const snapshot = buildCaseAnalyticsSnapshot(params, progressEngine);
  return {
    schemaVersion: 2,
    ...snapshot,
    ...stakeholder,
    progressEngine,
    progressSource: (params.sessions || []).length > 0 ? 'progressEngine' : 'fallback',
  };
}

module.exports = {
  buildCaseAnalyticsSnapshot,
  buildUnifiedCaseAnalytics,
  DOMAIN_BUCKETS,
};
