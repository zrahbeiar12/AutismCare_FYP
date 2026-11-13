const mongoose = require('mongoose');
const { ChildCase } = require('../models/ChildCase');
const Submission = require('../models/Submission');
const ASQ_CUTOFFS = require('../utils/asqCutoffs');

function inferRiskFromSubmission(sub) {
  if (!sub) return 'unknown';
  if (sub.riskLevel && ['low', 'medium', 'high'].includes(String(sub.riskLevel).toLowerCase())) {
    return String(sub.riskLevel).toLowerCase();
  }
  const r = sub.result;
  if (r === 'Pass') return 'low';
  if (r === 'Monitor') return 'medium';
  if (r === 'Fail') return 'high';
  return 'unknown';
}

const RISK_RANK = { unknown: 0, low: 1, medium: 2, high: 3 };

/** Higher-concern of two risk levels (unknown < low < medium < high). */
function maxRisk(a, b) {
  const ra = RISK_RANK[a] ?? 0;
  const rb = RISK_RANK[b] ?? 0;
  return ra >= rb ? (a in RISK_RANK ? a : 'unknown') : b;
}

/** ASQ-3 domains in the order the questionnaire presents them. */
const ASQ_DOMAIN_ORDER = ['Communication', 'Gross Motor', 'Fine Motor', 'Problem Solving', 'Personal-Social'];

/** Map the stored ASQ-3 domain status text onto a compact zone. */
function asqZoneFromStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('referral')) return 'refer';
  if (s.includes('monitor')) return 'monitor';
  if (s.includes('normal')) return 'ok';
  if (s.includes('incomplete')) return 'incomplete';
  return 'unknown';
}

function cutoffFor(intervalMonths, domain) {
  const byInterval = ASQ_CUTOFFS[Number(intervalMonths)];
  if (!byInterval) return null;
  return byInterval[String(domain).replace(/[\s-]+/g, '')] || null;
}

function summarizeMchat(sub) {
  if (!sub) return null;
  return {
    submissionId: sub._id,
    completedAt: sub.createdAt,
    totalScore: typeof sub.scores?.totalScore === 'number' ? sub.scores.totalScore : null,
    maxScore: 20,
    result: sub.result || null,
    riskLevel: inferRiskFromSubmission(sub),
    clinicianDecision: sub.clinicianDecision?.decision || null,
  };
}

function summarizeAsq(sub) {
  if (!sub) return null;
  const scores = sub.scores?.domainScores && typeof sub.scores.domainScores === 'object' ? sub.scores.domainScores : {};
  const statuses =
    sub.scores?.domainStatuses && typeof sub.scores.domainStatuses === 'object' ? sub.scores.domainStatuses : {};
  const names = [
    ...ASQ_DOMAIN_ORDER.filter((d) => d in scores || d in statuses),
    ...Object.keys({ ...scores, ...statuses }).filter((d) => !ASQ_DOMAIN_ORDER.includes(d)),
  ];
  const domains = names.map((domain) => {
    const cutoff = cutoffFor(sub.intervalMonths, domain);
    return {
      domain,
      score: typeof scores[domain] === 'number' ? scores[domain] : null,
      maxScore: 60,
      referralCutoff: cutoff ? cutoff.referral : null,
      monitorCutoff: cutoff ? cutoff.monitor : null,
      status: statuses[domain] || null,
      zone: asqZoneFromStatus(statuses[domain]),
    };
  });
  return {
    submissionId: sub._id,
    completedAt: sub.createdAt,
    intervalMonths: sub.intervalMonths ?? null,
    result: sub.result || null,
    riskLevel: inferRiskFromSubmission(sub),
    clinicianDecision: sub.clinicianDecision?.decision || null,
    domains,
  };
}

/**
 * Latest M-CHAT-R and latest ASQ-3 for one child, plus the combined risk.
 * `subs` must be that child's submissions sorted newest first.
 * The combined risk is the higher concern of the two latest results, so a later ASQ-3 "Pass" cannot
 * hide an earlier high-risk M-CHAT-R (and vice versa).
 */
function summarizeLatestScreenings(subs) {
  const list = Array.isArray(subs) ? subs : [];
  const mchat = summarizeMchat(list.find((s) => s.questionnaireType === 'MCHAT-R'));
  const asq3 = summarizeAsq(list.find((s) => s.questionnaireType === 'ASQ-3'));
  const overallRisk = maxRisk(mchat?.riskLevel || 'unknown', asq3?.riskLevel || 'unknown');
  return { mchat, asq3, overallRisk };
}

/**
 * Latest screenings for many children in one query: Map(childId string → summarizeLatestScreenings()).
 */
async function loadLatestScreeningsForChildren(childIds) {
  const ids = [...new Set((childIds || []).map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const out = new Map();
  if (!ids.length) return out;
  const subs = await Submission.find({ childId: { $in: ids } })
    .select('childId questionnaireType intervalMonths scores result riskLevel clinicianDecision createdAt')
    .sort({ createdAt: -1 })
    .lean();
  const byChild = new Map();
  for (const s of subs) {
    const key = String(s.childId);
    if (!byChild.has(key)) byChild.set(key, []);
    byChild.get(key).push(s);
  }
  for (const id of ids) out.set(id, summarizeLatestScreenings(byChild.get(id) || []));
  return out;
}

/**
 * Build screening summary from Submission collection for a child subdocument id.
 */
async function buildScreeningSummaryForChild(childId) {
  const subs = await Submission.find({ childId })
    .sort({ createdAt: -1 })
    .lean();

  if (!subs.length) {
    return {
      hasScreening: false,
      message: 'No screening data on file for this child.',
      submissions: [],
      latest: null,
      latestByType: { mchat: null, asq3: null },
      overallRisk: 'unknown',
    };
  }

  const latestByType = summarizeLatestScreenings(subs);

  const submissions = subs.map((s) => ({
    submissionId: s._id,
    questionnaireType: s.questionnaireType,
    result: s.result,
    riskLevel: inferRiskFromSubmission(s),
    completedAt: s.createdAt,
    totalScore: s.scores?.totalScore,
  }));

  const latest = subs[0];
  return {
    hasScreening: true,
    message: null,
    submissions,
    latest: {
      questionnaireType: latest.questionnaireType,
      result: latest.result,
      riskLevel: inferRiskFromSubmission(latest),
      resultDescription: latest.resultDescription,
      totalScore: latest.scores?.totalScore,
    },
    latestByType: { mchat: latestByType.mchat, asq3: latestByType.asq3 },
    overallRisk: latestByType.overallRisk,
  };
}

function riskFromSummary(screeningSummary) {
  if (!screeningSummary || !screeningSummary.hasScreening || !screeningSummary.latest) {
    return 'unknown';
  }
  const r = screeningSummary.overallRisk || screeningSummary.latest.riskLevel;
  return ['low', 'medium', 'high'].includes(r) ? r : 'unknown';
}

module.exports = {
  buildScreeningSummaryForChild,
  summarizeLatestScreenings,
  loadLatestScreeningsForChildren,
  asqZoneFromStatus,
  maxRisk,
  inferRiskFromSubmission,
  riskFromSummary,
};
