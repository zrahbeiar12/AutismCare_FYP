/**
 * Uploaded files (lab reports, children's photos, home-practice evidence, appointment documents, professional
 * registration papers) are patient data. They used to be served publicly from /uploads to anyone with the link.
 * This middleware runs after `protect` and lets a request through only when the signed-in user may see the record
 * that owns the file. Rules mirror what each role can already see through the API.
 */
const path = require('path');
const { ChildCase } = require('../models/ChildCase');
const { User } = require('../models/User');
const { Appointment } = require('../models/Appointment');
const { HomeAssignment } = require('../models/HomeAssignment');
const LabReport = require('../models/LabReport');
const LabRequest = require('../models/LabRequest');
const LabTestRequest = require('../models/LabTestRequest');
const { LabTestOrder } = require('../models/LabTestOrder');
const { assertUserCaseAccess } = require('../utils/caseAccess');
const { assertTherapistCaseAccess } = require('../utils/therapistCaseAccess');

const same = (a, b) => a != null && b != null && String(a) === String(b);

function roleOf(req) {
  return String(req.user?.role || req.jwtRole || '').toLowerCase();
}

async function parentOwnsChild(userId, childId) {
  if (!childId) return false;
  const found = await User.findOne({ _id: userId, role: 'parent', 'children._id': childId }).select('_id').lean();
  return Boolean(found);
}

async function therapistCanSeeChild(req, childId) {
  const cases = await ChildCase.find({ childId }).select('_id').lean();
  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    const access = await assertTherapistCaseAccess(req, String(c._id), req.user._id);
    if (access.ok) return true;
  }
  return false;
}

async function canSeeLabFile(req, url) {
  const uid = req.user._id;
  const role = roleOf(req);

  const report = await LabReport.findOne({ fileUrl: url }).lean();
  if (report) {
    const request = await LabTestRequest.findById(report.testRequestId).lean();
    if (same(report.clinicianId, uid) || same(request?.clinicianId, uid) || same(report.labTechnicianId, uid)) return true;
    const released = Boolean(request?.releasedToParent) || String(request?.status || '') === 'RELEASED';
    if (!released) return false;
    if (role === 'parent') return same(request?.parentId, uid);
    if (role === 'therapist') return therapistCanSeeChild(req, report.childId);
    return false;
  }

  const legacy = await LabRequest.findOne({ report_url: url }).lean();
  if (legacy) {
    if (same(legacy.clinician_id, uid) || same(legacy.lab_id, uid)) return true;
    if (String(legacy.status) !== 'completed') return false;
    if (role === 'parent') return parentOwnsChild(uid, legacy.child_id);
    if (role === 'therapist') return therapistCanSeeChild(req, legacy.child_id);
    return false;
  }

  const order = await LabTestOrder.findOne({ reportUrl: url }).lean();
  if (order) {
    if (same(order.clinicianId, uid) || same(order.labTechnicianId, uid)) return true;
    return role === 'parent' && order.isReleasedToParent === true && same(order.parentId, uid);
  }
  return false;
}

async function canSeeFile(req, url, folder) {
  const uid = req.user._id;
  const role = roleOf(req);
  if (role === 'admin' && folder !== 'reports') return true;

  switch (folder) {
    case 'lab-reports':
      return canSeeLabFile(req, url);
    case 'home-assignments': {
      const ha = await HomeAssignment.findOne({ $or: [{ 'parentSubmission.fileUrl': url }, { 'parentSubmission.submissionUrl': url }] })
        .select('caseId')
        .lean();
      if (!ha) return false;
      const access = await assertUserCaseAccess(req, String(ha.caseId));
      return access.ok;
    }
    case 'appointment-documents': {
      const appt = await Appointment.findOne({ documents: url }).select('parent professional').lean();
      return Boolean(appt) && (same(appt.parent, uid) || same(appt.professional, uid));
    }
    case 'documents': {
      const owner = await User.findOne({ 'documents.url': url }).select('_id').lean();
      return Boolean(owner) && same(owner._id, uid);
    }
    case 'facial-screening':
      // Not linked to any record; names are long random values. Limit to the roles that use the feature.
      return role === 'parent' || role === 'clinician';
    default:
      // reports/ PDFs are served by GET /api/reports/:id/download, which checks permissions itself.
      return false;
  }
}

/** Express middleware for `app.use('/uploads', protect, authorizeUploadAccess, express.static(...))`. */
async function authorizeUploadAccess(req, res, next) {
  try {
    const rel = decodeURIComponent(String(req.path || '')).replace(/\\/g, '/');
    const normalized = path.posix.normalize(rel);
    if (normalized.includes('..')) return res.status(400).json({ message: 'Invalid file path' });
    const folder = normalized.replace(/^\/+/, '').split('/')[0];
    const url = `/uploads${normalized.startsWith('/') ? '' : '/'}${normalized}`;
    if (!(await canSeeFile(req, url, folder))) {
      return res.status(403).json({ message: 'You do not have access to this file' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return next();
  } catch (err) {
    console.error('authorizeUploadAccess:', err);
    return res.status(500).json({ message: 'Could not check file access' });
  }
}

module.exports = { authorizeUploadAccess, canSeeFile };
