const mongoose = require('mongoose');
const { ChildCase } = require('../models/ChildCase');
const { computeProgressEngineForCase, fiveToPct } = require('../services/progressEngine');
const SessionLog = require('../models/SessionLog');
const TherapyPlan = require('../models/TherapyPlan');
const { parseResponseScore, parseScale1to5 } = require('../utils/sessionResponseScore');

function mean(nums) {
  const arr = Array.isArray(nums) ? nums.filter((n) => n != null && Number.isFinite(Number(n))).map(Number) : [];
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function toFive(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  if (n <= 5) return n;
  if (n <= 100) return (n / 100) * 5;
  return null;
}

function rowToFive(row) {
  const r = row && typeof row === 'object' ? row : {};
  if (r.score != null) return toFive(r.score);
  if (r.rating != null) return toFive(r.rating);
  // accuracy_trials
  if (r.trials != null && r.correct != null) {
    const trials = Number(r.trials);
    const correct = Number(r.correct);
    if (Number.isFinite(trials) && trials > 0 && Number.isFinite(correct) && correct >= 0) {
      return toFive((correct / trials) * 100);
    }
  }
  return null;
}

async function buildPerSessionTrend(caseId) {
  const sessions = await SessionLog.find({ caseId, status: 'completed' })
    .select('sessionDate goalData status noteState')
    .sort({ sessionDate: 1 })
    .lean();

  const points = [];
  for (const s of sessions) {
    const rows = Array.isArray(s.goalData) ? s.goalData : [];
    const rowScores = rows.map((r) => rowToFive(r)).filter((v) => v != null);
    const sessionScoreFive = rowScores.length ? mean(rowScores) : null;
    if (sessionScoreFive == null) continue;
    const d = s.sessionDate ? new Date(s.sessionDate) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const day = d.toISOString().slice(0, 10);
    points.push({ date: day, value: Number((sessionScoreFive * 20).toFixed(2)) });
  }
  // Keep the most recent 12 points (UI-friendly).
  return points.slice(-12);
}

function legacySessionPct(session) {
  const scale = parseScale1to5(session.childResponse);
  if (scale != null) return (scale / 5) * 100;
  const s = parseResponseScore(session.childResponse);
  return s != null ? s : null;
}

function normalizeLegacyDomainLabel(label) {
  const d = String(label || '').trim();
  if (!d) return '';
  if (d.toLowerCase() === 'ot') return 'Occupational Therapy';
  if (d.toLowerCase() === 'occupational therapy') return 'Occupational Therapy';
  return d;
}

async function buildDomainTrendFromPlan(caseId, requestedDomainLabel) {
  const domainLabel = normalizeLegacyDomainLabel(requestedDomainLabel);
  if (!domainLabel) return [];

  const plan = await TherapyPlan.findOne({ caseId }).sort({ updatedAt: -1 }).lean();
  if (!plan) return [];

  const goals = Array.isArray(plan.shortTermGoals) ? plan.shortTermGoals : [];
  const goalTitleToDomain = new Map(
    goals.map((g) => [String(g?.title || '').trim(), normalizeLegacyDomainLabel(g?.domain)]).filter(([k]) => k)
  );

  const activities = Array.isArray(plan.activities) ? plan.activities : [];
  const activityToDomain = new Map();
  for (const a of activities) {
    const title = String(a?.title || '').trim();
    const linkedGoal = String(a?.linkedGoal || '').trim();
    if (!title || !linkedGoal) continue;
    const d = goalTitleToDomain.get(linkedGoal);
    if (d) activityToDomain.set(title, d);
  }

  const sessions = await SessionLog.find({ caseId, status: 'completed' })
    .select('sessionDate goalsTargeted childResponse')
    .sort({ sessionDate: 1 })
    .lean();

  const points = [];
  for (const s of sessions) {
    const targeted = Array.isArray(s.goalsTargeted) ? s.goalsTargeted : [];
    const hit = targeted.some((t) => normalizeLegacyDomainLabel(activityToDomain.get(String(t || '').trim())) === domainLabel);
    if (!hit) continue;
    const pct = legacySessionPct(s);
    if (pct == null) continue;
    const d = s.sessionDate ? new Date(s.sessionDate) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const day = d.toISOString().slice(0, 10);
    points.push({ date: day, value: Number(pct) });
  }
  return points;
}

async function assertClinicianCaseOwnership(caseId, clinicianId) {
  if (!mongoose.Types.ObjectId.isValid(caseId)) return null;
  return ChildCase.findOne({ _id: caseId, clinicianId }).lean();
}

/**
 * Shared goal/session analytics for a case (same math as clinician overview).
 * Used by GET /api/progress/:caseId/overview and integration GET /api/case/:caseId/progress.
 */
exports.computeCaseProgressOverview = async function computeCaseProgressOverview(caseId) {
  if (!mongoose.Types.ObjectId.isValid(caseId)) {
    return { success: false, error: 'invalid_case' };
  }
  const result = await computeProgressEngineForCase(caseId, { useCache: true });
  if (!result.success) {
    return { success: false, error: 'engine_failed', message: result.message || 'Failed to compute progress' };
  }

  const engine = result.data || null;
  if (!engine) {
    return {
      success: true,
      data: {
        overallProgressPercent: 0,
        totalGoals: 0,
        achievedGoals: 0,
        domains: [],
        trendData: [],
        progressEngine: null,
      },
      message: 'No progress data available',
    };
  }

  const goals = Array.isArray(engine.goals) ? engine.goals : [];
  const totalGoals = goals.length;
  const achievedGoals = goals.filter((g) => g && (g.mastery === true || String(g.masteryStatus || '') === 'mastered')).length;
  const overallProgressPercent =
    engine.overallScore != null
      ? fiveToPct(engine.overallScore)
      : totalGoals
        ? Number(((achievedGoals / totalGoals) * 100).toFixed(2))
        : 0;

  // Domain view: legacy bucket labels with engine-derived score averages (0–100).
  const domainMap = new Map();
  for (const g of goals) {
    if (!g) continue;
    const legacy = String(g.legacyDomain || '').trim();
    const name = legacy || String(g.domain || '').trim() || 'General';
    if (!domainMap.has(name)) {
      domainMap.set(name, { domain: name, totalGoals: 0, achievedGoals: 0, scoreSum: 0, scoreN: 0 });
    }
    const row = domainMap.get(name);
    row.totalGoals += 1;
    if (g.mastery === true || String(g.masteryStatus || '') === 'mastered') row.achievedGoals += 1;
    if (g.current != null && Number.isFinite(Number(g.current))) {
      row.scoreSum += Number(g.current);
      row.scoreN += 1;
    }
  }
  const domains = Array.from(domainMap.values()).map((d) => ({
    ...d,
    progressPercent:
      d.scoreN > 0
        ? fiveToPct(d.scoreSum / d.scoreN)
        : d.totalGoals
          ? Number(((d.achievedGoals / d.totalGoals) * 100).toFixed(2))
          : 0,
  }));

  // Trend chart: use engine series (keyed by YYYY-MM-DD).
  const trendData = (Array.isArray(engine.weeklyTrend) ? engine.weeklyTrend : [])
    .filter((w) => w && w.week)
    .map((w) => ({
      date: String(w.week),
      value: w.y != null ? Number((Number(w.y) * 20).toFixed(2)) : null,
    }));

  return {
    success: true,
    data: {
      overallProgressPercent,
      totalGoals,
      achievedGoals,
      domains,
      trendData,
      progressEngine: engine,
    },
    ...(result.cached ? { cached: true } : {}),
  };
};

// GET /api/progress/:caseId/overview
exports.getProgressOverview = async (req, res) => {
  try {
    const { caseId } = req.params;
    const clinicianId = req.user._id;
    const owned = await assertClinicianCaseOwnership(caseId, clinicianId);
    if (!owned) return res.status(404).json({ success: false, message: 'Case not found' });

    const result = await exports.computeCaseProgressOverview(caseId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Invalid case id' });
    }

    const body = { success: true, data: result.data };
    if (result.message) body.message = result.message;
    return res.status(200).json(body);
  } catch (error) {
    console.error('getProgressOverview:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch progress overview' });
  }
};

// GET /api/progress/:caseId/domain/:domain
exports.getDomainProgress = async (req, res) => {
  try {
    const { caseId, domain: requestedDomain } = req.params;
    const clinicianId = req.user._id;
    const owned = await assertClinicianCaseOwnership(caseId, clinicianId);
    if (!owned) return res.status(404).json({ success: false, message: 'Case not found' });
    const result = await exports.computeCaseProgressOverview(caseId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || 'Invalid case id' });
    }

    const domain = String(requestedDomain || '').trim().toLowerCase();
    const goals = Array.isArray(result.data?.progressEngine?.goals) ? result.data.progressEngine.goals : [];

    // Support legacy aliases: "OT" => "Occupational Therapy"
    const requested = domain === 'ot' ? 'occupational therapy' : domain;
    const supported = [...new Set(goals.map((g) => String(g?.legacyDomain || '').trim()).filter(Boolean))];
    const matchName =
      supported.find((d) => d.toLowerCase() === requested) ||
      supported.find((d) => d.toLowerCase() === domain) ||
      null;

    if (!matchName) {
      return res.status(400).json({
        success: false,
        message: `Unsupported domain. Use one of: ${supported.join(', ')}`,
      });
    }

    const domainGoals = goals.filter((g) => g && String(g.legacyDomain || '').toLowerCase() === matchName.toLowerCase());
    const totalGoals = domainGoals.length;
    const achievedGoals = domainGoals.filter(
      (g) => g.mastery === true || String(g.masteryStatus || '') === 'mastered'
    ).length;
    const scored = domainGoals.filter((g) => g.current != null && Number.isFinite(Number(g.current)));
    const domainProgressPct =
      scored.length > 0
        ? Number(
            (
              (scored.reduce((s, g) => s + Number(g.current), 0) / scored.length / 5) *
              100
            ).toFixed(2)
          )
        : totalGoals
          ? Number(((achievedGoals / totalGoals) * 100).toFixed(2))
          : 0;

    return res.status(200).json({
      success: true,
      data: {
        domain: matchName,
        progressPercent: domainProgressPct,
        totalGoals,
        achievedGoals,
        // Trend points relevant to this domain (derived from plan activities + session goalsTargeted).
        trendData: await buildDomainTrendFromPlan(caseId, matchName),
      },
    });
  } catch (error) {
    console.error('getDomainProgress:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch domain progress' });
  }
};

// GET /api/progress/:caseId/sessions
exports.getSessionInsights = async (req, res) => {
  try {
    const { caseId } = req.params;
    const clinicianId = req.user._id;
    const owned = await assertClinicianCaseOwnership(caseId, clinicianId);
    if (!owned) return res.status(404).json({ success: false, message: 'Case not found' });
    const result = await exports.computeCaseProgressOverview(caseId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || 'Invalid case id' });
    }
    const engine = result.data?.progressEngine || null;
    const insights = Array.isArray(engine?.sessionInsights) ? engine.sessionInsights : [];
    const totalSessions = Number(engine?._meta?.sessionsCounted || 0);
    const lastSessionDate = insights.length ? insights[insights.length - 1].sessionDate : null;

    return res.status(200).json({
      success: true,
      data: {
        totalSessions,
        // Convert 0–5 engine score avg to 0–100 for clinician UI consistency.
        averageResponseScore:
          engine?._meta?.therapyScoreAvg != null ? Number((Number(engine._meta.therapyScoreAvg) * 20).toFixed(2)) : 0,
        lastSessionDate,
        recentActivity: insights.slice(-5).reverse(),
      },
      message: totalSessions ? undefined : 'No sessions available',
    });
  } catch (error) {
    console.error('getSessionInsights:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch session insights' });
  }
};
