const mongoose = require('mongoose');
const { assertUserCaseAccess } = require('../utils/caseAccess');
const { computeProgressEngineForCase, fiveToPct } = require('../services/progressEngine');
const { getLabContextForCase, buildCrossDomainInsights } = require('../services/clinicalCorrelationService');

function parentSummary(full) {
  if (!full) return null;
  const sessionsN = Number(full._meta?.sessionsCounted || 0);
  const homeRatingsN = Number(full._meta?.homeRatingsCounted || 0);
  const assignN = Number(full._meta?.totalAssignments ?? 0);
  /** No logged therapy signals and no home program activity — avoid generic "steady" copy. */
  if (sessionsN === 0 && homeRatingsN === 0 && assignN === 0) {
    return null;
  }
  const confOverall = Number(full.confidence?.overall ?? 0);
  const limited = confOverall > 0 && confOverall < 0.4;
  const pct = fiveToPct(full.overallScore);

  let trendLabel = 'steady';
  const ot = String(full.overallTrend || '').toLowerCase();
  if (ot === 'improving') trendLabel = 'improving';
  else if (ot === 'declining') trendLabel = 'needs_attention';

  const consistency = full.consistency;
  const domainRows = (full.domainScores && full.domainScores.length ? full.domainScores : full.domains || []).map(
    (d) => ({
      name: d.name || '—',
      score: typeof d.score === 'number' ? d.score : 0,
      confidence: typeof d.confidence === 'number' ? d.confidence : d.confidenceScore,
    })
  );

  const goalsBrief = Array.isArray(full.goals)
    ? full.goals.slice(0, 12).map((g) => ({
        goalId: g.goalId,
        goalName: g.goalName,
        trend: g.trend,
        current: limited ? null : g.current,
        confidenceLabel: g.confidenceLabel,
        limitedDataUi: limited || Boolean(g.limitedDataUi),
      }))
    : [];

  const alerts = (full.smartAlerts || []).slice(0, 12).map((a) => ({
    severity: a.severity || 'warning',
    message: a.message,
    code: a.code,
  }));

  return {
    progressPercent: limited ? null : pct,
    trendLabel,
    headline:
      trendLabel === 'improving'
        ? 'Great momentum'
        : trendLabel === 'needs_attention'
          ? 'Needs attention'
          : 'Steady progress',
    consistencyPercent: consistency != null ? Math.round(Number(consistency) * 100) : null,
    homeProgramOnTrack: consistency == null ? null : consistency >= 0.5,
    message: limited
      ? 'Progress direction is uncertain with current data. Your care team will interpret this with you.'
      : 'Your care team can share more detail in visits and written updates.',
    confidenceLabel: full.confidence?.label,
    interpretWithCaution: limited,
    domainScores: domainRows,
    goalsBrief,
    alertsParent: alerts,
  };
}

function buildSummaryPayload(data) {
  if (!data) return null;
  const doms = data.domains || [];
  let weakestDomain = null;
  let lowest = 999;
  for (const d of doms) {
    if (d.score < lowest) {
      lowest = d.score;
      weakestDomain = d.name;
    }
  }
  const trend =
    (data.improvementRate || 0) > 0.05 ? 'improving' : (data.improvementRate || 0) < -0.05 ? 'declining' : 'stable';
  return {
    overallScore: data.overallScore,
    improvementRate: data.improvementRate,
    weakestDomain,
    trend,
    alertCount: (data.smartAlerts || []).length,
  };
}

/**
 * GET /api/progress-engine/:caseId/summary
 * Lightweight snapshot for dashboards (therapist + clinician). Parents use GET /:caseId (summary payload).
 */
exports.getProgressEngineSummary = async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }
    const access = await assertUserCaseAccess(req, caseId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }
    const role = String(req.user.role || req.jwtRole || '').toLowerCase();
    if (role === 'parent') {
      return res.status(403).json({ success: false, message: 'Use the parent summary on the main progress endpoint' });
    }
    const therapistId = role === 'therapist' ? req.user._id : undefined;
    const result = await computeProgressEngineForCase(caseId, { therapistId, useCache: true });
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || 'Failed to compute summary' });
    }
    let crossDomainInsights = [];
    try {
      const labCtx = await getLabContextForCase(caseId);
      crossDomainInsights = buildCrossDomainInsights(result.data, labCtx);
    } catch (_) {}
    return res.status(200).json({
      success: true,
      data: buildSummaryPayload(result.data),
      meta: { role, cached: Boolean(result.cached), crossDomainInsights },
    });
  } catch (error) {
    console.error('getProgressEngineSummary:', error);
    return res.status(500).json({ success: false, message: 'Failed to load summary' });
  }
};

/**
 * GET /api/progress-engine/:caseId
 * Therapist: scoped to their plan/sessions/assignments.
 * Clinician: case-wide data with primary plan resolution inside engine.
 * Parent: limited summary only.
 */
exports.getProgressEngine = async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }

    const access = await assertUserCaseAccess(req, caseId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const role = String(req.user.role || req.jwtRole || '').toLowerCase();
    const therapistId = role === 'therapist' ? req.user._id : undefined;

    const result = await computeProgressEngineForCase(caseId, { therapistId, useCache: true });
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || 'Failed to compute progress' });
    }

    let data = result.data;
    if (role === 'parent') {
      data = parentSummary(data);
    }

    let crossDomainInsights = [];
    if (role !== 'parent') {
      try {
        const labCtx = await getLabContextForCase(caseId);
        crossDomainInsights = buildCrossDomainInsights(result.data, labCtx);
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      data,
      meta: { role, scope: role === 'parent' ? 'summary' : 'full', cached: Boolean(result.cached), crossDomainInsights },
    });
  } catch (error) {
    console.error('getProgressEngine:', error);
    return res.status(500).json({ success: false, message: 'Failed to load progress engine' });
  }
};
