const { ChildCase, CASE_LIFECYCLE_STATUS } = require('../models/ChildCase');
const { User } = require('../models/User');
const { buildProgressEnginePayload, loadCaseProgressInputs } = require('../services/progressEngine');
const { scheduleEmitClinicalEvent, slimProgressSnapshot } = require('../services/clinicalEventService');
const { buildCrossDomainInsights, getLabContextForCase } = require('../services/clinicalCorrelationService');

// Every lifecycle stage: a case assigned to this clinician belongs on their caseload (matches GET /api/cases).
const CLINICIAN_ALLOWED = CASE_LIFECYCLE_STATUS;

function normalizeCaseStatus(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  const legacyMap = {
    active: 'REVIEW',
    under_evaluation: 'REVIEW',
    referred: 'THERAPY',
    ongoing_therapy: 'THERAPY_ACTIVE',
  };
  return String(legacyMap[key] || raw).trim().toUpperCase();
}

function childDisplayName(childSub) {
  if (!childSub) return 'Unknown child';
  const fn = childSub.firstName || '';
  const ln = childSub.lastName || '';
  return `${fn} ${ln}`.trim() || 'Child';
}

function urgencyScoreFromEngine(engine) {
  if (!engine) return 0;
  const status = String(engine.overallClinicalStatus || 'on_track');
  let s = 0;
  if (status === 'high_concern') s += 100;
  else if (status === 'needs_attention') s += 50;
  if (String(engine.overallTrend) === 'declining' || String(engine.shortTermTrend) === 'declining') s += 35;
  const conf = Number(engine.confidence?.overall ?? 1);
  if (conf < 0.4) s += 25;
  if (actionRequiredFromEngine(engine)) s += 15;
  const alerts = Array.isArray(engine.smartAlerts) ? engine.smartAlerts : [];
  s += alerts.filter((a) => String(a.severity || '').toLowerCase() === 'critical').length * 20;
  s += alerts.filter((a) => String(a.severity || '').toLowerCase() === 'warning').length * 8;
  return s;
}

function actionRequiredFromEngine(engine) {
  if (!engine) return false;
  const alerts = Array.isArray(engine.smartAlerts) ? engine.smartAlerts : [];
  if (alerts.some((a) => String(a.severity || '').toLowerCase() === 'critical')) return true;
  const co = Number(engine.confidence?.overall ?? 1);
  const declining =
    String(engine.overallTrend) === 'declining' || String(engine.shortTermTrend) === 'declining';
  return declining && co < 0.4;
}

/**
 * GET /api/clinician/caseload-progress
 * Bulk progress snapshots for clinician dashboard (minimal payload, urgency-sorted).
 */
exports.getCaseloadProgress = async (req, res) => {
  try {
    const clinicianId = req.user._id;
    const allCases = await ChildCase.find({ clinicianId }).sort({ updatedAt: -1 }).lean();
    const cases = allCases.filter((c) => CLINICIAN_ALLOWED.includes(normalizeCaseStatus(c.status)));

    if (!cases.length) {
      return res.status(200).json({
        success: true,
        data: {
          cases: [],
          health: { total: 0, onTrackPct: 0, needsAttentionPct: 0, highConcernPct: 0, counts: { on_track: 0, needs_attention: 0, high_concern: 0 } },
        },
      });
    }

    const parentIds = [...new Set(cases.map((c) => c.parentId.toString()))];
    const parents = await User.find({ _id: { $in: parentIds } })
      .select('firstName lastName email children')
      .lean();
    const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));

    // Same canonical inputs as parent/therapist views and reports (primary plan + that therapist's data), so the
    // caseload shows the same progress figures every other screen shows for the child.
    const inputsList = await Promise.all(cases.map((c) => loadCaseProgressInputs(String(c._id))));
    const inputsByCase = new Map(cases.map((c, i) => [String(c._id), inputsList[i]]));

    const rows = [];
    const bulkOps = [];
    const recommendationAudits = [];

    for (const c of cases) {
      const idStr = String(c._id);
      const p = parentMap.get(c.parentId.toString());
      let childName = 'Child';
      if (p && p.children && c.childId) {
        const sub = (p.children || []).find((ch) => ch._id && ch._id.toString() === c.childId.toString());
        if (sub) childName = childDisplayName(sub);
      }

      let loadError = null;
      let engine = null;
      try {
        const inputs = inputsByCase.get(idStr) || { plan: null, sessions: [], assignments: [] };
        const plan = inputs.plan;
        const sessions = inputs.sessions;
        const assigns = inputs.assignments;
        engine = buildProgressEnginePayload({
          caseId: idStr,
          plan,
          sessions,
          assignments: assigns,
        });
      } catch (err) {
        console.error('caseload-progress engine', idStr, err);
        loadError = 'Progress snapshot failed';
      }

      if (loadError || !engine) {
        rows.push({
          caseId: idStr,
          childName,
          status: normalizeCaseStatus(c.status) || c.status,
          riskLevel: c.riskLevel,
          updatedAt: c.updatedAt,
          loadError,
          snapshot: null,
          urgencyScore: loadError ? 999 : 0,
        });
        continue;
      }

      const alerts = Array.isArray(engine.smartAlerts) ? engine.smartAlerts : [];
      const topAlert = alerts[0] || null;
      const newRec = String(engine.clinicalRecommendation || '');
      const prevStored = c.progressEngineRecommendationSnapshot != null ? String(c.progressEngineRecommendationSnapshot) : null;
      const recommendationChanged = prevStored != null && prevStored !== newRec;
      const previousRecommendation = prevStored;
      const sessionsN = Number(engine._meta?.sessionsCounted || 0);
      let recommendationChangeHint = '';
      if (recommendationChanged) {
        recommendationChangeHint = `Recommendation changed — prior: "${(previousRecommendation || '').slice(0, 120)}${(previousRecommendation || '').length > 120 ? '…' : ''}"`;
      } else if (sessionsN > 0) {
        recommendationChangeHint = `No change in stored clinical recommendation across caseload reviews (${sessionsN} session(s) in engine window).`;
      } else {
        recommendationChangeHint = 'No session-derived recommendation history yet.';
      }

      const snapshot = {
        overallScore: engine.overallScore,
        overallTrend: engine.overallTrend,
        shortTermTrend: engine.shortTermTrend,
        longTermTrend: engine.longTermTrend,
        overallClinicalStatus: engine.overallClinicalStatus,
        clinicalRecommendation: engine.clinicalRecommendation,
        clinicalReasoning: String(engine.clinicalReasoning || '').slice(0, 400),
        confidence: engine.confidence,
        topAlert,
        smartAlerts: alerts.slice(0, 8),
        domainScores: engine.domainScores,
        weeklyTrendMini: (engine.weeklyTrend || []).slice(-10),
        recommendationChanged,
        previousRecommendation,
        recommendationChangeHint,
        actionRequired: actionRequiredFromEngine(engine),
        sessionsCounted: sessionsN,
      };

      rows.push({
        caseId: idStr,
        childName,
        status: normalizeCaseStatus(c.status) || c.status,
        riskLevel: c.riskLevel,
        updatedAt: c.updatedAt,
        loadError: null,
        snapshot,
        urgencyScore: urgencyScoreFromEngine(engine),
      });

      if (newRec && prevStored !== newRec) {
        bulkOps.push({
          updateOne: {
            filter: { _id: c._id },
            update: {
              $set: {
                progressEngineRecommendationSnapshot: newRec,
                progressEngineRecommendationAt: new Date(),
              },
            },
          },
        });
        recommendationAudits.push({
          caseId: idStr,
          previousRecommendation: prevStored,
          newRecommendation: newRec,
          engine,
        });
      }
    }

    rows.sort((a, b) => (b.urgencyScore || 0) - (a.urgencyScore || 0));

    const counts = { on_track: 0, needs_attention: 0, high_concern: 0 };
    for (const r of rows) {
      if (!r.snapshot) continue;
      const st = String(r.snapshot.overallClinicalStatus || 'on_track');
      if (st === 'high_concern') counts.high_concern += 1;
      else if (st === 'needs_attention') counts.needs_attention += 1;
      else counts.on_track += 1;
    }
    const triaged = rows.filter((r) => r.snapshot).length;
    const denom = triaged || 1;
    const health = {
      total: rows.length,
      triaged,
      counts,
      onTrackPct: Math.round((counts.on_track / denom) * 100),
      needsAttentionPct: Math.round((counts.needs_attention / denom) * 100),
      highConcernPct: Math.round((counts.high_concern / denom) * 100),
    };

    if (bulkOps.length) {
      await ChildCase.bulkWrite(bulkOps, { ordered: false });
    }

    for (const ra of recommendationAudits) {
      try {
        let cross = [];
        try {
          const labCtx = await getLabContextForCase(ra.caseId);
          cross = buildCrossDomainInsights(ra.engine, labCtx);
        } catch (_) {}
        scheduleEmitClinicalEvent({
          eventType: 'PROGRESS_UPDATED',
          caseId: ra.caseId,
          actorRole: 'clinician',
          actorId: clinicianId,
          linkedModules: ['progress'],
          payload: { trigger: 'recommendation_snapshot_refresh' },
          progressEngineSnapshot: ra.engine ? slimProgressSnapshot(ra.engine) : undefined,
          crossDomainInsight: cross.length ? cross : undefined,
          recommendationAudit: {
            previousRecommendation: ra.previousRecommendation || '',
            newRecommendation: ra.newRecommendation || '',
            changedByUserId: clinicianId,
            changedByRole: 'clinician',
          },
        });
      } catch (e) {
        console.error('clinical event caseload recommendation:', e);
      }
    }

    return res.status(200).json({ success: true, data: { cases: rows, health } });
  } catch (error) {
    console.error('getCaseloadProgress:', error);
    return res.status(500).json({ success: false, message: 'Failed to load caseload progress' });
  }
};
