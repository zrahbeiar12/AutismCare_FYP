const { getCurrentTimeMs } = require('../utils/time.js');
/**
 * Therapy reports. Every report type is built by services/standardReport.js from ONE canonical data set
 * (loadCaseProgressInputs + one progress-engine run), so parents, clinicians and therapists see the same
 * numbers for the same child. Only the audience section differs by type. No manual editing.
 */
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { ChildCase } = require('../models/ChildCase');
const { User } = require('../models/User');
const { ClinicalEvaluation } = require('../models/ClinicalEvaluation');
const { Report, REPORT_TYPES } = require('../models/Report');
const { assertTherapistCaseAccess } = require('../utils/therapistCaseAccess');
const { assertUserCaseAccess } = require('../utils/caseAccess');
const { buildProgressEnginePayload, loadCaseProgressInputs } = require('../services/progressEngine');
const { buildStandardReport, STANDARD_REPORT_SCHEMA } = require('../services/standardReport');
const { loadLatestScreeningsForChildren } = require('../services/childCase.service');
const {
  writeStandardReportPdf,
  writeIntegratedReportPdf,
  writeGenericReportPdf,
} = require('../services/reportPdfService');
const TherapyCase = require('../models/TherapyCase');
const { THERAPY_STATUS } = require('../constants/workflowEnums');

/** A second request for the same report type within this window returns the first report instead of a copy. */
const DUPLICATE_WINDOW_MS = 45 * 1000;

function normalizeReportType(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'report') return '';
  if (raw === 'session-summary') return 'session';
  if (raw === 'progress-report') return 'progress';
  if (raw === 'therapy-report') return 'therapy';
  if (raw === 'integrated' || raw === 'integrated-report') return 'integrated';
  return raw;
}

/** Shared gate: the requesting therapist must have an ACTIVE/COMPLETED therapy case for this child case. */
async function assertReportGenerationAllowed(req, caseId) {
  const therapistId = req.user._id;
  const access = await assertTherapistCaseAccess(req, caseId, therapistId);
  if (!access.ok) {
    return { ok: false, status: access.status || 403, body: { success: false, message: access.message || 'Access denied' } };
  }
  const therapyCase = await TherapyCase.findOne({
    caseId,
    therapistId,
    status: { $in: [THERAPY_STATUS.ACTIVE, THERAPY_STATUS.COMPLETED] },
  })
    .select('_id')
    .lean();
  if (!therapyCase) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message: 'Report generation not allowed: therapy must be ACTIVE or COMPLETED.',
        errorCode: 'INVALID_THERAPY_STATE',
      },
    };
  }
  return { ok: true };
}

/**
 * Build the standard report payload for a case from the canonical data set.
 * @returns {Promise<{ data: object, sessionsCount: number } | null>} null when the case does not exist
 */
async function buildReportForCase(caseId, type) {
  const caseDoc = await ChildCase.findById(caseId).lean();
  if (!caseDoc) return null;

  const [{ plan, therapistId, sessions, assignments }, parent, evaluation, screeningsByChild] = await Promise.all([
    loadCaseProgressInputs(caseId),
    User.findById(caseDoc.parentId).select('firstName lastName children').lean(),
    ClinicalEvaluation.findOne({ caseId, status: 'FINALIZED' }).sort({ createdAt: -1 }).lean(),
    loadLatestScreeningsForChildren([caseDoc.childId]),
  ]);

  const child =
    parent && Array.isArray(parent.children)
      ? parent.children.find((c) => c && c._id && String(c._id) === String(caseDoc.childId)) || null
      : null;

  let therapist =
    plan?.therapistId && typeof plan.therapistId === 'object' && plan.therapistId.firstName ? plan.therapistId : null;
  const therapistLookupId = therapistId || caseDoc.therapistId;
  if (!therapist && therapistLookupId) {
    therapist = await User.findById(therapistLookupId).select('firstName lastName specialization').lean();
  }

  const engine = buildProgressEnginePayload({ caseId: String(caseId), plan, sessions, assignments });
  const data = buildStandardReport(type, {
    caseDoc,
    child,
    parent,
    therapist,
    plan,
    sessions,
    assignments,
    engine,
    screenings: screeningsByChild.get(String(caseDoc.childId)) || null,
    evaluation,
  });
  return { data, sessionsCount: sessions.length };
}

/**
 * POST /api/reports/generate/:caseId
 * Integrated report (type: integrated) — requires at least one session log.
 */
exports.generateReportByCaseId = async (req, res) => {
  try {
    const { caseId } = req.params || {};
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }

    const gate = await assertReportGenerationAllowed(req, caseId);
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const built = await buildReportForCase(caseId, 'integrated');
    if (!built) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }
    if (built.sessionsCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'Report generation not allowed: at least one session log is required.',
        errorCode: 'NO_SESSIONS',
      });
    }

    const doc = await Report.create({ caseId, therapistId: req.user._id, type: 'integrated', data: built.data });

    return res.status(201).json({
      success: true,
      data: { reportId: doc._id, type: 'integrated', generatedAt: doc.data.generatedAt, data: doc.data },
    });
  } catch (error) {
    console.error('generateReportByCaseId:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate integrated report' });
  }
};

/**
 * POST /api/reports/generate
 */
exports.generateReport = async (req, res) => {
  try {
    const { caseId } = req.body || {};
    const type = normalizeReportType(req.body?.type || req.body?.reportType);
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }
    if (!type || !REPORT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid report type' });
    }

    const therapistId = req.user._id;
    const gate = await assertReportGenerationAllowed(req, caseId);
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const duplicateWindow = new Date(getCurrentTimeMs() - DUPLICATE_WINDOW_MS);
    const recent = await Report.findOne({
      caseId,
      therapistId,
      type,
      createdAt: { $gte: duplicateWindow },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (recent) {
      return res.status(200).json({
        success: true,
        data: {
          reportId: recent._id,
          duplicate: true,
          type: recent.data?.type || type,
          generatedAt: recent.data?.generatedAt || recent.createdAt,
          data: recent.data,
        },
      });
    }

    const built = await buildReportForCase(caseId, type);
    if (!built) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    const dedupeKey = `${caseId}:${therapistId}:${type}:${Math.floor(getCurrentTimeMs() / DUPLICATE_WINDOW_MS)}`;
    let doc;
    try {
      doc = await Report.create({ caseId, therapistId, type, data: built.data, dedupeKey });
    } catch (err) {
      if (err && err.code === 11000) {
        const existing = await Report.findOne({ dedupeKey }).lean();
        if (existing) {
          return res.status(200).json({
            success: true,
            data: {
              reportId: existing._id,
              duplicate: true,
              type: existing.data?.type || type,
              generatedAt: existing.data?.generatedAt || existing.createdAt,
              data: existing.data,
            },
          });
        }
      }
      throw err;
    }

    return res.status(201).json({
      success: true,
      data: {
        reportId: doc._id,
        type: doc.data.type,
        generatedAt: doc.data.generatedAt,
        data: doc.data,
      },
    });
  } catch (error) {
    console.error('generateReport:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
};

/**
 * GET /api/reports
 * Therapist list page (all owned reports with optional filters).
 */
exports.listMyReports = async (req, res) => {
  try {
    const role = String(req.user.role || req.jwtRole || '').toLowerCase();
    if (role !== 'therapist') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const therapistId = req.user._id;
    const { caseId, type, from, to } = req.query || {};
    const filter = { therapistId };

    if (caseId) {
      if (!mongoose.Types.ObjectId.isValid(caseId)) {
        return res.status(400).json({ success: false, message: 'Invalid caseId filter' });
      }
      filter.caseId = caseId;
    }

    const normType = normalizeReportType(type);
    if (normType) {
      if (!REPORT_TYPES.includes(normType)) {
        return res.status(400).json({ success: false, message: 'Invalid report type filter' });
      }
      filter.type = normType;
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) {
        const fromDate = new Date(String(from));
        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid from date' });
        }
        filter.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(String(to));
        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid to date' });
        }
        filter.createdAt.$lte = toDate;
      }
    }

    const rows = await Report.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id,
        caseId: r.caseId,
        type: r.type,
        therapistId: r.therapistId,
        generatedAt: r.data?.generatedAt || r.createdAt,
        insufficientData: Boolean(r.data?.insufficientData),
        childName: r.data?.child?.name || r.data?.childInfo?.childName || 'Child',
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error('listMyReports:', error);
    return res.status(500).json({ success: false, message: 'Failed to load reports' });
  }
};

/**
 * GET /api/reports/:caseId
 */
exports.listReportsByCase = async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }

    const gate = await assertUserCaseAccess(req, caseId);
    if (!gate.ok) {
      return res.status(gate.status || 403).json({ success: false, message: gate.message || 'Access denied' });
    }

    const role = String(req.user.role || req.jwtRole || '').toLowerCase();
    const filter = { caseId };
    if (role === 'parent') {
      filter.type = 'parent';
    } else if (role === 'clinician') {
      filter.type = { $in: ['clinician', 'integrated'] };
    }

    const rows = await Report.find(filter).sort({ createdAt: -1 }).limit(80).lean();
    return res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id,
        caseId: r.caseId,
        type: r.type,
        therapistId: r.therapistId,
        generatedAt: r.data?.generatedAt || r.createdAt,
        insufficientData: Boolean(r.data?.insufficientData),
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error('listReportsByCase:', error);
    return res.status(500).json({ success: false, message: 'Failed to list reports' });
  }
};

/**
 * GET /api/reports/view/:id
 */
exports.getReportById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid report id' });
    }

    const report = await Report.findById(id).lean();
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const gate = await assertUserCaseAccess(req, report.caseId);
    if (!gate.ok) {
      return res.status(gate.status || 403).json({ success: false, message: gate.message || 'Access denied' });
    }

    const role = String(req.user.role || req.jwtRole || '').toLowerCase();
    const t = report.type;
    if (role === 'parent' && t !== 'parent') {
      return res.status(403).json({ success: false, message: 'Not allowed to view this report type' });
    }
    if (role === 'clinician' && t !== 'clinician' && t !== 'integrated') {
      return res.status(403).json({ success: false, message: 'Not allowed to view this report type' });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: report._id,
        caseId: report.caseId,
        type: report.type,
        therapistId: report.therapistId,
        generatedAt: report.data?.generatedAt || report.createdAt,
        data: report.data,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    console.error('getReportById:', error);
    return res.status(500).json({ success: false, message: 'Failed to load report' });
  }
};

function pdfFilename(report) {
  const name =
    String(report?.data?.child?.name || report?.data?.childInfo?.childName || 'child')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'child';
  const date = new Date(report?.data?.generatedAt || report?.createdAt || Date.now()).toISOString().slice(0, 10);
  return `AutismCare_${report?.type || 'report'}_${name}_${date}.pdf`;
}

/**
 * GET /api/reports/:reportId/download
 * Generates PDF on first request, caches path on the report document.
 */
exports.downloadReportPdf = async (req, res) => {
  try {
    const { reportId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ success: false, message: 'Invalid report id' });
    }

    const report = await Report.findById(reportId).lean();
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const role = String(req.user.role || req.jwtRole || '').toLowerCase();

    if (role === 'therapist') {
      if (String(report.therapistId) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      const access = await assertTherapistCaseAccess(req, String(report.caseId), req.user._id);
      if (!access.ok) {
        return res.status(access.status || 403).json({ success: false, message: access.message || 'Access denied' });
      }
    } else {
      const gate = await assertUserCaseAccess(req, report.caseId);
      if (!gate.ok) {
        return res.status(gate.status || 403).json({ success: false, message: gate.message || 'Access denied' });
      }
      const t = report.type;
      if (role === 'parent' && t !== 'parent') {
        return res.status(403).json({ success: false, message: 'Not allowed to download this report type' });
      }
      if (role === 'clinician' && t !== 'clinician' && t !== 'integrated') {
        return res.status(403).json({ success: false, message: 'Not allowed to download this report type' });
      }
    }

    let rel = report.pdfRelativePath && String(report.pdfRelativePath).trim();
    const ensurePdf = async () => {
      if (report.data?.schema === STANDARD_REPORT_SCHEMA) {
        return writeStandardReportPdf(report._id, report.data);
      }
      if (report.type === 'integrated') {
        return writeIntegratedReportPdf(report._id, report.data || {});
      }
      return writeGenericReportPdf(report._id, report.type, report.data || {});
    };

    if (!rel) {
      rel = await ensurePdf();
      await Report.updateOne({ _id: report._id }, { $set: { pdfRelativePath: rel } });
    }

    const safeRel = String(rel).replace(/^\/+/, '');
    const absPath = path.join(process.cwd(), safeRel);
    if (!fs.existsSync(absPath)) {
      rel = await ensurePdf();
      await Report.updateOne({ _id: report._id }, { $set: { pdfRelativePath: rel } });
      const safe2 = String(rel).replace(/^\/+/, '');
      const abs2 = path.join(process.cwd(), safe2);
      if (!fs.existsSync(abs2)) {
        return res.status(500).json({ success: false, message: 'PDF file could not be created' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename(report)}"`);
      return res.sendFile(abs2);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename(report)}"`);
    return res.sendFile(absPath);
  } catch (error) {
    console.error('downloadReportPdf:', error);
    return res.status(500).json({ success: false, message: 'Failed to download report' });
  }
};
