const mongoose = require('mongoose');
const { ChildCase, CASE_LIFECYCLE_STATUS } = require('../models/ChildCase');
const { User } = require('../models/User');
const { Appointment } = require('../models/Appointment');
const { getLabRequestsForCase } = require('../utils/labCaseIntegration');
const { loadLatestScreeningsForChildren } = require('../services/childCase.service');
const { assignCaseFileNumber } = require('../services/caseFileNumberService');
const { calculateAgeInMonths } = require('../utils/ageUtils');

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
  const mapped = legacyMap[key] || raw;
  return String(mapped).trim().toUpperCase();
}

function childDisplayName(childSub) {
  if (!childSub) return 'Unknown child';
  const fn = childSub.firstName || '';
  const ln = childSub.lastName || '';
  return `${fn} ${ln}`.trim() || 'Child';
}

/**
 * GET /api/cases — list cases for logged-in clinician
 */
exports.getCases = async (req, res) => {
  try {
    const clinicianId = req.user._id;
    const { riskLevel, status } = req.query;

    // Every case assigned to this clinician belongs in their list, whatever its stage (write actions stay
    // state-gated elsewhere). NEW/SCREENING used to be excluded, which hid cases created by the clinician
    // or booked before the parent finished screening.
    // IMPORTANT: do NOT filter by status in the Mongo query: legacy records can have non-enum casing
    // (e.g. "Review"), so status is normalized in JS after fetch.
    const allCases = await ChildCase.find({ clinicianId }).sort({ updatedAt: -1 }).lean();

    const requestedStatus = status ? normalizeCaseStatus(status) : null;
    const requestedRisk =
      riskLevel && ['low', 'medium', 'high', 'unknown'].includes(String(riskLevel)) ? String(riskLevel) : null;

    const statusMatched = allCases.filter((c) => {
      const st = normalizeCaseStatus(c.status);
      if (!CASE_LIFECYCLE_STATUS.includes(st)) return false;
      if (requestedStatus && requestedStatus !== 'ALL' && st !== requestedStatus) return false;
      return true;
    });

    const parentIds = [...new Set(statusMatched.map((c) => c.parentId.toString()))];
    const [parents, screeningsByChild] = await Promise.all([
      User.find({ _id: { $in: parentIds } }).select('firstName lastName email children').lean(),
      // Results are read from the submissions themselves (not the snapshot stored on the case), so the list is
      // correct even for cases whose snapshot predates the latest questionnaire.
      loadLatestScreeningsForChildren(statusMatched.map((c) => c.childId)),
    ]);
    const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));

    const data = [];
    for (const c of statusMatched) {
      const p = parentMap.get(c.parentId.toString());
      const sub =
        p && Array.isArray(p.children) && c.childId
          ? p.children.find((ch) => ch._id && ch._id.toString() === c.childId.toString())
          : null;
      const screenings = screeningsByChild.get(String(c.childId)) || { mchat: null, asq3: null, overallRisk: 'unknown' };
      const hasScreening = Boolean(screenings.mchat || screenings.asq3);
      // Risk shown and filtered on = combined latest screening risk; fall back to the stored value only when
      // there is no screening on file (e.g. legacy cases).
      const risk = hasScreening ? screenings.overallRisk : c.riskLevel || 'unknown';
      if (requestedRisk && risk !== requestedRisk) continue;

      const dob = sub?.dateOfBirth || null;
      data.push({
        _id: c._id,
        childId: c.childId,
        childName: sub ? childDisplayName(sub) : 'Child',
        child: sub
          ? {
              dateOfBirth: dob,
              ageMonths: dob ? calculateAgeInMonths(dob) : null,
              gender: sub.gender || null,
            }
          : null,
        parentName: p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : '—',
        parentEmail: p?.email || null,
        riskLevel: risk,
        screenings: { mchat: screenings.mchat, asq3: screenings.asq3 },
        status: normalizeCaseStatus(c.status) || c.status,
        fileNumber: c.fileNumber || null,
        mrNumber: c.mrNumber || null,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
      });
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('getCases:', error);
    res.status(500).json({ success: false, message: 'Failed to load cases' });
  }
};

/**
 * GET /api/cases/:id — full case detail
 */
exports.getCaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const clinicianId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid case id' });
    }

    const doc = await ChildCase.findOne({ _id: id, clinicianId }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }
    // Clinicians can view their assigned case across lifecycle states.
    // Any write operations remain protected by validateCaseState and service guards.

    const parent = await User.findById(doc.parentId)
      .select('firstName lastName email phoneNumber children')
      .lean();

    let childProfile = null;
    if (parent && parent.children && doc.childId) {
      const sub = parent.children.find((ch) => ch._id && ch._id.toString() === doc.childId.toString());
      if (sub) {
        childProfile = {
          id: sub._id,
          firstName: sub.firstName,
          lastName: sub.lastName,
          dateOfBirth: sub.dateOfBirth,
          gender: sub.gender,
          medicalHistory: sub.medicalHistory,
          allergies: sub.allergies,
        };
      }
    }

    const parentInfo = parent
      ? {
          id: parent._id,
          firstName: parent.firstName,
          lastName: parent.lastName,
          email: parent.email,
          phoneNumber: parent.phoneNumber,
        }
      : null;

    let appointment = null;
    if (doc.appointmentId) {
      const appt = await Appointment.findById(doc.appointmentId)
        .select('status appointmentType preferredDate preferredTime finalDate finalTime')
        .lean();
      if (appt) appointment = appt;
    }

    const labRequests = await getLabRequestsForCase(doc, 'clinician');

    res.status(200).json({
      success: true,
      data: {
        ...doc,
        childProfile,
        parentInfo,
        appointment,
        labRequests,
        statusOptions: CASE_LIFECYCLE_STATUS,
      },
    });
  } catch (error) {
    console.error('getCaseById:', error);
    res.status(500).json({ success: false, message: 'Failed to load case' });
  }
};

/**
 * POST /api/cases/create — legacy compatibility.
 * Creates/assigns a clinician-visible case WITHOUT allowing manual status changes.
 * - If case exists (parentId+childId), assigns clinicianId if empty.
 * - If case does not exist, creates it in NEW state.
 */
exports.createCase = async (req, res) => {
  try {
    const clinicianId = req.user._id;
    const { parentId, childId } = req.body || {};

    if (!parentId || !childId) {
      return res.status(400).json({ success: false, message: 'parentId and childId are required' });
    }
    if (!mongoose.Types.ObjectId.isValid(parentId) || !mongoose.Types.ObjectId.isValid(childId)) {
      return res.status(400).json({ success: false, message: 'Invalid parentId or childId' });
    }

    let doc = await ChildCase.findOne({ parentId, childId });
    if (doc) {
      if (doc.clinicianId && String(doc.clinicianId) !== String(clinicianId)) {
        return res.status(403).json({ success: false, message: 'Case is assigned to another clinician' });
      }
      if (!doc.clinicianId) {
        doc.clinicianId = clinicianId;
        await doc.save();
        const numbered = await assignCaseFileNumber(doc._id, { clinicianId });
        return res.status(201).json({ success: true, message: 'Case assigned', data: numbered || doc });
      }
      return res.status(409).json({ success: false, message: 'Case already exists', data: doc });
    }

    doc = await ChildCase.create({
      parentId,
      childId,
      clinicianId,
      status: 'NEW',
      caseHistory: [
        {
          fromStatus: null,
          toStatus: 'NEW',
          event: 'LEGACY_CASE_CREATED',
          timestamp: new Date(),
          triggeredBy: clinicianId,
        },
      ],
    });

    const numbered = await assignCaseFileNumber(doc._id, { clinicianId });
    return res.status(201).json({ success: true, message: 'Case created', data: numbered || doc });
  } catch (error) {
    console.error('createCase:', error);
    return res.status(500).json({ success: false, message: 'Failed to create case' });
  }
};

/**
 * POST /api/cases/from-appointment — legacy compatibility.
 * Assigns clinicianId on the parent+child case linked to the appointment.
 */
exports.createFromAppointment = async (req, res) => {
  try {
    const clinicianId = req.user._id;
    const { appointmentId } = req.body || {};

    if (!appointmentId || !mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ success: false, message: 'Valid appointmentId is required' });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
    if (String(appointment.professionalRole) !== 'clinician') {
      return res.status(400).json({ success: false, message: 'Only clinician appointments can link cases' });
    }
    if (String(appointment.professional) !== String(clinicianId)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this appointment' });
    }

    const parentId = appointment.parent;
    const childId = appointment.child;

    const doc = await ChildCase.findOneAndUpdate(
      { parentId, childId },
      { $set: { clinicianId, appointmentId: appointment._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const numbered = await assignCaseFileNumber(doc._id, { clinicianId });
    return res.status(200).json({ success: true, message: 'Case linked', data: numbered || doc });
  } catch (error) {
    console.error('createFromAppointment:', error);
    return res.status(500).json({ success: false, message: 'Failed to link case to appointment' });
  }
};

/**
 * PATCH /api/cases/:id/mr-number — set the hospital's Medical Record number on a case (clinician who owns it).
 * Unique within the case's organisation; empty value clears it.
 */
exports.updateMrNumber = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid case id' });
    }
    const raw = String(req.body?.mrNumber ?? '').trim();
    if (raw.length > 40 || (raw && !/^[A-Za-z0-9][A-Za-z0-9\-\/ .]*$/.test(raw))) {
      return res.status(400).json({ success: false, message: 'MR number may use letters, digits, spaces, "-", "/" and "." (max 40)' });
    }
    const doc = await ChildCase.findOne({ _id: id, clinicianId: req.user._id });
    if (!doc) return res.status(404).json({ success: false, message: 'Case not found' });
    if (!doc.fileNumber) await assignCaseFileNumber(doc._id, { clinicianId: req.user._id });
    const update = raw ? { $set: { mrNumber: raw } } : { $unset: { mrNumber: 1 } };
    try {
      const saved = await ChildCase.findByIdAndUpdate(doc._id, update, { new: true }).lean();
      return res.status(200).json({ success: true, data: { fileNumber: saved.fileNumber, mrNumber: saved.mrNumber || null } });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ success: false, message: 'This MR number is already used for another child in your organisation' });
      }
      throw err;
    }
  } catch (error) {
    console.error('updateMrNumber:', error);
    return res.status(500).json({ success: false, message: 'Failed to update MR number' });
  }
};
