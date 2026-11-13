/**
 * Standard report (schema "standard-v1").
 *
 * Every report type — parent, clinician, integrated, progress, monthly, IEP, therapy, session — is built from
 * the SAME core: one canonical set of inputs (loadCaseProgressInputs), one progress-engine run, one unit
 * (whole-number percent), one domain list. Only the `audience` section differs by type, so a parent, a
 * clinician and a therapist reading reports for the same child always see the same numbers.
 */
const { getCurrentTime } = require('../utils/time.js');
const { fiveToPct } = require('./progressEngine');
const { diagnosisText, evaluationText } = require('../utils/evaluationText');

const SCHEMA = 'standard-v1';

const REPORT_TITLES = {
  parent: 'Parent Progress Report',
  clinician: 'Clinical Progress Report',
  integrated: 'Integrated Therapy Report',
  progress: 'Progress Report',
  monthly: 'Monthly Therapy Report',
  iep: 'Individualized Education Plan (IEP) Review',
  therapy: 'Therapy Plan Report',
  session: 'Session Summary Report',
};

/** Report areas follow the therapy plan's own domains (what therapists set and parents recognise). */
const AREA_LABELS = {
  Speech: 'Speech & language',
  'Occupational Therapy': 'Occupational therapy',
  Behavioral: 'Behaviour',
  Sensory: 'Sensory',
};
const areaLabel = (legacy) => AREA_LABELS[legacy] || (legacy ? String(legacy) : 'Other');

const CLINICAL_STATUS_LABELS = {
  on_track: 'On track',
  needs_attention: 'Needs attention',
  high_concern: 'High concern',
};

const TREND_LABELS = { improving: 'Improving', stable: 'Stable', declining: 'Declining', stagnant: 'Stable' };

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(d) {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function ageParts(dob, now) {
  if (!dob) return { ageMonths: null, ageText: null };
  const b = new Date(dob);
  if (Number.isNaN(b.getTime())) return { ageMonths: null, ageText: null };
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m || !y) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return { ageMonths: months, ageText: parts.join(' ') };
}

function personName(p) {
  if (!p) return null;
  const n = `${p.firstName || ''} ${p.lastName || ''}`.trim();
  return n || null;
}

function sessionDone(s) {
  const st = String(s?.status || 'completed').toLowerCase();
  return st === 'completed' || st === 'signed';
}

function trendLabel(t) {
  return TREND_LABELS[String(t || '').toLowerCase()] || 'Not enough data';
}

function goalStatus(g) {
  if (g.mastery === true || String(g.masteryStatus || '') === 'mastered') return 'Achieved';
  if (g.currentPct == null) return 'Not started';
  if (g.targetPct != null && g.currentPct >= g.targetPct) return 'Target reached';
  if (String(g.trend) === 'declining') return 'Needs support';
  if (g.changePts != null && g.changePts > 0) return 'Progressing';
  return 'In progress';
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

/** Plain, number-bearing sentence shared by every audience (parents get it as the lead). */
function summarySentence(childFirst, stats) {
  const who = childFirst || 'Your child';
  if (stats.overallProgressPct == null) {
    return `${who} does not have enough scored therapy sessions yet for a progress figure. Results will appear after the first scored sessions.`;
  }
  const parts = [`${who} is at ${stats.overallProgressPct}% overall progress across therapy goals`];
  if (stats.improvementPts != null) {
    if (stats.improvementPts > 0) parts.push(`up ${stats.improvementPts} points from the starting baseline`);
    else if (stats.improvementPts < 0) parts.push(`${Math.abs(stats.improvementPts)} points below the starting baseline`);
    else parts.push('level with the starting baseline');
  }
  let s = `${parts.join(', ')}.`;
  if (stats.sessionsCompleted) {
    s += ` ${stats.sessionsCompleted} session${stats.sessionsCompleted === 1 ? '' : 's'} completed`;
    s += stats.attendancePct != null ? ` (${stats.attendancePct}% attendance)` : '';
    s += stats.homePracticePct != null ? `, home practice ${stats.homePracticePct}% complete.` : '.';
  }
  return s;
}

function buildCore(ctx) {
  const { caseDoc, child, parent, therapist, plan, sessions, assignments, engine, screenings, now } = ctx;
  const sessionsAsc = [...(sessions || [])].sort((a, b) => new Date(a.sessionDate) - new Date(b.sessionDate));
  const done = sessionsAsc.filter(sessionDone);
  const missed = sessionsAsc.filter((s) => String(s.status || '').toLowerCase() === 'missed');
  const assigns = assignments || [];
  const assignmentsCompleted = assigns.filter((a) => String(a.status || '') === 'completed').length;

  const goals = (engine?.goals || []).map((g) => {
    const baselinePct = fiveToPct(g.baseline);
    const currentPct = fiveToPct(g.current);
    const targetPct = fiveToPct(g.target);
    const row = {
      goalId: String(g.goalId),
      name: String(g.goalName || 'Goal'),
      domain: areaLabel(g.legacyDomain),
      baselinePct,
      currentPct,
      targetPct,
      changePts: baselinePct != null && currentPct != null ? currentPct - baselinePct : null,
      trend: String(g.trend || ''),
      trendLabel: trendLabel(g.trend),
      dataPoints: Number(g.dataPoints || 0),
      mastery: g.mastery === true,
      masteryStatus: g.masteryStatus,
    };
    row.status = goalStatus(row);
    delete row.mastery;
    delete row.masteryStatus;
    return row;
  });

  const goalsWithBoth = goals.filter((g) => g.baselinePct != null && g.currentPct != null);
  const avgBaseline = mean(goalsWithBoth.map((g) => g.baselinePct));
  const avgCurrent = mean(goalsWithBoth.map((g) => g.currentPct));

  const firstDate = done[0]?.sessionDate || null;
  const lastDate = done[done.length - 1]?.sessionDate || null;
  const spanDays = firstDate && lastDate ? Math.round((new Date(lastDate) - new Date(firstDate)) / DAY_MS) : null;

  const stats = {
    overallProgressPct: engine && engine._meta?.sessionsCounted > 0 ? fiveToPct(engine.overallScore) : null,
    baselinePct: avgBaseline != null ? Math.round(avgBaseline) : null,
    currentPct: avgCurrent != null ? Math.round(avgCurrent) : null,
    improvementPts: avgBaseline != null && avgCurrent != null ? Math.round(avgCurrent) - Math.round(avgBaseline) : null,
    dataConfidence: engine?.confidence?.label || null,
    overallTrend: String(engine?.overallTrend || ''),
    overallTrendLabel: trendLabel(engine?.overallTrend),
    clinicalStatus: String(engine?.overallClinicalStatus || ''),
    clinicalStatusLabel: CLINICAL_STATUS_LABELS[engine?.overallClinicalStatus] || 'Not enough data',
    sessionsCompleted: done.length,
    sessionsMissed: missed.length,
    attendancePct: done.length + missed.length > 0 ? Math.round((done.length / (done.length + missed.length)) * 100) : null,
    homePracticePct:
      engine?.consistency != null
        ? Math.round(Number(engine.consistency) * 100)
        : assigns.length
          ? Math.round((assignmentsCompleted / assigns.length) * 100)
          : null,
    assignmentsTotal: assigns.length,
    assignmentsCompleted,
    goalsTotal: goals.length,
    goalsAchieved: goals.filter((g) => g.status === 'Achieved' || g.status === 'Target reached').length,
  };

  // One row per plan area: average current level of that area's goals (0–5 → %), trend from its goals.
  const byArea = new Map();
  for (const g of engine?.goals || []) {
    const label = areaLabel(g.legacyDomain);
    if (!byArea.has(label)) byArea.set(label, { scores: [], trends: [] });
    const bucket = byArea.get(label);
    if (g.current != null) bucket.scores.push(Number(g.current));
    bucket.trends.push(String(g.trend || ''));
  }
  const domains = [...byArea.entries()].map(([label, b]) => {
    const tr = b.trends.includes('declining') ? 'declining' : b.trends.includes('improving') ? 'improving' : b.scores.length ? 'stable' : '';
    return {
      key: label.toLowerCase().replace(/[^a-z]+/g, '-'),
      label,
      scorePct: b.scores.length ? fiveToPct(mean(b.scores)) : null,
      trend: tr,
      trendLabel: trendLabel(tr),
    };
  });

  const trend = (engine?.weeklyTrend || [])
    .map((w) => ({ date: String(w.week || w.x || ''), pct: fiveToPct(w.y) }))
    .filter((p) => p.date && p.pct != null);

  const improvements = goals
    .filter((g) => g.changePts != null && g.changePts > 0)
    .sort((a, b) => b.changePts - a.changePts)
    .slice(0, 6)
    .map((g) => `${g.name}: ${g.baselinePct}% → ${g.currentPct}% (+${g.changePts} points)`);

  const attention = goals
    .filter((g) => g.trend === 'declining' || (g.currentPct != null && g.currentPct < 40))
    .slice(0, 6)
    .map((g) =>
      g.trend === 'declining'
        ? `${g.name}: trending down (now ${g.currentPct ?? '—'}%)`
        : `${g.name}: still low at ${g.currentPct}%`
    );

  const recommendations = [];
  if (engine?.clinicalRecommendation) recommendations.push(String(engine.clinicalRecommendation));
  for (const a of engine?.smartAlerts || []) {
    const sev = String(a.severity || '').toLowerCase();
    if ((sev === 'critical' || sev === 'warning') && a.message) recommendations.push(String(a.message));
  }
  for (const w of engine?.weakAreas || []) {
    const txt = typeof w === 'string' ? w : w?.reason;
    if (txt) recommendations.push(String(txt));
  }
  if (!recommendations.length) recommendations.push('Continue the current plan, keep the session schedule and daily home practice.');

  const dob = child?.dateOfBirth || null;
  const { ageMonths, ageText } = ageParts(dob, now);

  return {
    child: {
      name: personName(child) || 'Child',
      firstName: child?.firstName || null,
      dateOfBirth: iso(dob),
      ageMonths,
      ageText,
      gender: child?.gender ? String(child.gender).replace(/^\w/, (c) => c.toUpperCase()) : null,
    },
    parentName: personName(parent),
    therapistName: personName(therapist),
    therapistSpecialization: therapist?.specialization || null,
    caseRef: caseDoc.fileNumber || String(caseDoc._id).slice(-8).toUpperCase(),
    fileNumber: caseDoc.fileNumber || null,
    mrNumber: caseDoc.mrNumber || null,
    case: { caseId: String(caseDoc._id), status: caseDoc.status || null, riskLevel: caseDoc.riskLevel || 'unknown' },
    period: {
      firstSessionDate: iso(firstDate),
      lastSessionDate: iso(lastDate),
      weeks: spanDays != null ? Math.max(1, Math.round(spanDays / 7)) : null,
    },
    screening: { mchat: screenings?.mchat || null, asq3: screenings?.asq3 || null },
    stats,
    summary: summarySentence(child?.firstName, stats),
    domains,
    goals,
    trend,
    highlights: {
      improvements: improvements.length ? improvements : ['No measurable gains recorded yet.'],
      needsAttention: attention,
    },
    recommendations: [...new Set(recommendations)].slice(0, 8),
    insufficientData: !plan && done.length === 0 && assigns.length === 0,
  };
}

function recentNotes(sessionsAsc, field, n) {
  return sessionsAsc
    .map((s) => String(s?.[field] || '').trim())
    .filter(Boolean)
    .slice(-n)
    .reverse();
}

function buildAudience(type, ctx, core) {
  const { plan, sessions, evaluation, now } = ctx;
  const sessionsAsc = [...(sessions || [])].sort((a, b) => new Date(a.sessionDate) - new Date(b.sessionDate));
  const planSafe = plan || {};
  const shortGoals = Array.isArray(planSafe.shortTermGoals) ? planSafe.shortTermGoals : [];
  const activities = Array.isArray(planSafe.activities) ? planSafe.activities : [];
  const lt = planSafe.longTermGoal;

  const clinical = () => ({
    diagnosis: evaluation
      ? {
          diagnosis: diagnosisText(evaluation.diagnosis) || null,
          developmentalSummary: evaluationText(evaluation.developmentalSummary) || null,
          recommendations: evaluationText(evaluation.recommendations) || null,
        }
      : null,
    alerts: (ctx.engine?.smartAlerts || [])
      .filter((a) => ['critical', 'warning'].includes(String(a.severity || '').toLowerCase()))
      .slice(0, 8)
      .map((a) => ({ severity: String(a.severity).toLowerCase(), message: String(a.message || '') })),
    therapistObservations: recentNotes(sessionsAsc, 'notes', 6),
  });

  switch (type) {
    case 'parent': {
      const tips = [];
      for (const a of activities.slice(0, 5)) if (a?.title) tips.push(a.description ? `${a.title}: ${a.description}` : a.title);
      // Only instructions from sessions that actually happened, newest first, without repeats.
      for (const t of recentNotes(sessionsAsc.filter(sessionDone), 'parentInstructions', 6)) tips.push(t);
      const unique = [...new Set(tips.map((x) => x.trim()).filter(Boolean))];
      return {
        kind: 'parent',
        homeTips: unique.length ? unique.slice(0, 8) : ['Keep following the home activities your therapist sets and note what you see each day.'],
      };
    }
    case 'clinician':
    case 'integrated':
      return { kind: type, ...clinical() };
    case 'iep': {
      let nextReview = null;
      for (const g of shortGoals) {
        if (g?.reviewDate) {
          const d = new Date(g.reviewDate);
          if (!Number.isNaN(d.getTime()) && (!nextReview || d < nextReview)) nextReview = d;
        }
      }
      return {
        kind: 'iep',
        longTermGoal: lt && (lt.title || lt.description) ? { title: lt.title || '', description: lt.description || '', timeline: lt.timeline || '' } : null,
        shortTermGoals: shortGoals.map((g) => ({
          title: g.title || '',
          criteria: g.measurableCriteria || '',
          reviewDate: iso(g.reviewDate),
        })),
        strategies: activities.filter((a) => a?.title).map((a) => ({ title: a.title, description: a.description || '' })),
        nextReviewBy: iso(nextReview || new Date(now.getTime() + 28 * DAY_MS)),
      };
    }
    case 'therapy':
      return {
        kind: 'therapy',
        planDomains: Array.isArray(planSafe.domains) ? planSafe.domains : [],
        longTermGoal: lt && (lt.title || lt.description) ? { title: lt.title || '', description: lt.description || '' } : null,
        activities: activities.filter((a) => a?.title).map((a) => ({ title: a.title, description: a.description || '' })),
      };
    case 'session':
      return {
        kind: 'session',
        recentSessions: sessionsAsc
          .slice(-12)
          .reverse()
          .map((s) => ({
            date: iso(s.sessionDate),
            durationMin: Number(s.duration || 0) || null,
            status: String(s.status || 'completed'),
            childResponse: String(s.childResponse || ''),
            notes: String(s.notes || '').slice(0, 160),
          })),
      };
    case 'monthly': {
      const since = new Date(now.getTime() - 30 * DAY_MS);
      const inMonth = sessionsAsc.filter((s) => new Date(s.sessionDate) >= since);
      return {
        kind: 'monthly',
        periodStart: since.toISOString(),
        periodEnd: now.toISOString(),
        sessionsThisMonth: inMonth.filter(sessionDone).length,
        missedThisMonth: inMonth.filter((s) => String(s.status || '').toLowerCase() === 'missed').length,
        therapistNotes: recentNotes(inMonth, 'notes', 6),
      };
    }
    default:
      return { kind: 'progress' };
  }
}

/**
 * @param {string} type one of REPORT_TYPES
 * @param {{ caseDoc, child, parent, therapist, plan, sessions, assignments, engine, screenings, evaluation }} ctx
 */
function buildStandardReport(type, ctx) {
  const now = getCurrentTime();
  const full = { ...ctx, now };
  const core = buildCore(full);
  return {
    schema: SCHEMA,
    type,
    title: REPORT_TITLES[type] || 'Progress Report',
    generatedAt: now.toISOString(),
    ...core,
    audience: buildAudience(type, full, core),
    disclaimer:
      'Screening and progress figures support professional judgement; they are not a diagnosis. Percentages are goal performance on the therapy plan, measured across scored sessions.',
  };
}

module.exports = { buildStandardReport, STANDARD_REPORT_SCHEMA: SCHEMA, REPORT_TITLES };
