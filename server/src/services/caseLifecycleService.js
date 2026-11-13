const mongoose = require('mongoose');
const { ChildCase, CASE_LIFECYCLE_STATUS } = require('../models/ChildCase');
const { assignCaseFileNumber } = require('./caseFileNumberService');

const CASE_EVENTS = {
  CHILD_CREATED: 'CHILD_CREATED',
  SCREENING_STARTED: 'SCREENING_STARTED',
  SCREENING_SUBMITTED: 'SCREENING_SUBMITTED',
  CLINICIAN_APPOINTMENT_BOOKED: 'CLINICIAN_APPOINTMENT_BOOKED',
  CLINICIAN_PRESCRIBES_LAB_TEST: 'CLINICIAN_PRESCRIBES_LAB_TEST',
  LAB_ACCEPTS_REQUEST: 'LAB_ACCEPTS_REQUEST',
  LAB_UPLOADS_REPORT: 'LAB_UPLOADS_REPORT',
  CLINICIAN_REVIEWS_REPORT: 'CLINICIAN_REVIEWS_REPORT',
  CLINICIAN_FINAL_EVALUATION_DECIDED: 'CLINICIAN_FINAL_EVALUATION_DECIDED',
  THERAPIST_ACCEPTS_CASE: 'THERAPIST_ACCEPTS_CASE',
  THERAPY_PROGRESS_COMPLETED: 'THERAPY_PROGRESS_COMPLETED',
};

function isValidStatus(s) {
  return CASE_LIFECYCLE_STATUS.includes(String(s));
}

function normalizeCaseStatus(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  // Mirror ChildCase.status legacy mapping, but normalize to enum casing.
  const legacyMap = {
    active: 'REVIEW',
    under_evaluation: 'REVIEW',
    referred: 'THERAPY',
    ongoing_therapy: 'THERAPY_ACTIVE',
  };
  const mapped = legacyMap[key] || raw;
  return String(mapped).trim().toUpperCase();
}

function invalidTransition(message, extra) {
  const err = new Error(message);
  err.code = 'INVALID_CASE_TRANSITION';
  if (extra) err.details = extra;
  return err;
}

async function loadCaseOrThrow({ caseId, parentId, childId }) {
  if (caseId) {
    if (!mongoose.Types.ObjectId.isValid(caseId)) throw invalidTransition('Invalid caseId');
    const doc = await ChildCase.findById(caseId);
    if (!doc) throw invalidTransition('Case not found');
    return doc;
  }

  if (!parentId || !childId) throw invalidTransition('caseId or (parentId, childId) required');
  if (!mongoose.Types.ObjectId.isValid(parentId) || !mongoose.Types.ObjectId.isValid(childId)) {
    throw invalidTransition('Invalid parentId or childId');
  }

  const doc = await ChildCase.findOne({ parentId, childId });
  if (!doc) throw invalidTransition('Case not found');
  return doc;
}

async function ensureCaseExists({ parentId, childId, triggeredBy }) {
  if (!mongoose.Types.ObjectId.isValid(parentId) || !mongoose.Types.ObjectId.isValid(childId)) {
    throw invalidTransition('Invalid parentId or childId');
  }
  const existing = await ChildCase.findOne({ parentId, childId });
  if (existing) return existing;

  const created = await ChildCase.create({
    parentId,
    childId,
    status: 'NEW',
    caseHistory: [
      {
        fromStatus: null,
        toStatus: 'NEW',
        event: CASE_EVENTS.CHILD_CREATED,
        timestamp: new Date(),
        triggeredBy: triggeredBy || null,
      },
    ],
  });
  return created;
}

function computeTransition({ currentStatus, eventType, payload }) {
  const status = normalizeCaseStatus(currentStatus || 'NEW') || 'NEW';

  switch (eventType) {
    case CASE_EVENTS.CHILD_CREATED:
      return { toStatus: 'NEW', updates: {} };

    case CASE_EVENTS.SCREENING_STARTED: {
      if (!['NEW', 'MONITORING', 'SCREENING'].includes(status)) {
        throw invalidTransition('Cannot start screening from current status', { from: status, eventType });
      }
      const skippedMchat = payload?.screeningFlow?.skippedMchat === true;
      return {
        toStatus: 'SCREENING',
        updates: skippedMchat
          ? { screeningProgress: { mchatCompleted: false, asqCompleted: false, skippedMchat: true } }
          : {},
      };
    }

    case CASE_EVENTS.SCREENING_SUBMITTED: {
      // Primary path: SCREENING → REVIEW. Also allow repeat / late questionnaires when the case is already
      // in parent-facing stages (e.g. never received SCREENING_STARTED, or rescreen while in REVIEW/MONITORING).
      const allowedSubmit = ['SCREENING', 'NEW', 'REVIEW', 'MONITORING'];
      if (!allowedSubmit.includes(status)) {
        throw invalidTransition('Cannot submit screening from current case stage', { from: status, eventType });
      }
      const riskLevel = payload?.riskLevel;
      if (riskLevel && !['low', 'medium', 'high', 'unknown'].includes(String(riskLevel))) {
        throw invalidTransition('Invalid riskLevel', { riskLevel });
      }
      const screeningProgress = payload?.screeningProgress && typeof payload.screeningProgress === 'object'
        ? payload.screeningProgress
        : null;
      return {
        toStatus: 'REVIEW',
        updates: {
          ...(riskLevel ? { riskLevel: String(riskLevel) } : {}),
          ...(payload?.screeningSummary ? { screeningSummary: payload.screeningSummary } : {}),
          ...(screeningProgress ? { screeningProgress } : {}),
        },
      };
    }

    case CASE_EVENTS.CLINICIAN_APPOINTMENT_BOOKED: {
      if (!['REVIEW', 'NEW', 'SCREENING'].includes(status)) {
        throw invalidTransition('Clinician appointment booking is only valid in REVIEW', { from: status, eventType });
      }
      const clinicianId = payload?.clinicianId;
      if (clinicianId && !mongoose.Types.ObjectId.isValid(clinicianId)) {
        throw invalidTransition('Invalid clinicianId', { clinicianId });
      }
      const appointmentId = payload?.appointmentId;
      // An approved clinician appointment means the clinician is now reviewing the child, so the case moves to
      // REVIEW even if screening was never finished. Leaving it in NEW/SCREENING hid it from the clinician's
      // case lists (they only show REVIEW onwards).
      return {
        toStatus: 'REVIEW',
        updates: {
          ...(clinicianId ? { clinicianId } : {}),
          ...(appointmentId && mongoose.Types.ObjectId.isValid(appointmentId) ? { appointmentId } : {}),
        },
      };
    }

    case CASE_EVENTS.CLINICIAN_PRESCRIBES_LAB_TEST: {
      if (!['REVIEW', 'NEW', 'SCREENING', 'DIAGNOSIS'].includes(status)) {
        throw invalidTransition('Cannot prescribe lab tests unless in REVIEW', { from: status, eventType });
      }
      return { toStatus: 'DIAGNOSIS', updates: {} };
    }

    case CASE_EVENTS.LAB_ACCEPTS_REQUEST: {
      if (!['DIAGNOSIS'].includes(status)) {
        throw invalidTransition('Lab can only accept requests in DIAGNOSIS', { from: status, eventType });
      }
      return { toStatus: 'DIAGNOSIS', updates: {} };
    }

    case CASE_EVENTS.LAB_UPLOADS_REPORT: {
      if (!['DIAGNOSIS'].includes(status)) {
        throw invalidTransition('Cannot upload lab report unless case is DIAGNOSIS', { from: status, eventType });
      }
      return { toStatus: 'DIAGNOSIS_READY', updates: {} };
    }

    case CASE_EVENTS.CLINICIAN_REVIEWS_REPORT: {
      if (!['DIAGNOSIS_READY', 'REVIEW'].includes(status)) {
        throw invalidTransition('Clinician can only review report in DIAGNOSIS_READY (or REVIEW for legacy flows)', {
          from: status,
          eventType,
        });
      }
      const therapyNeeded = payload?.therapyNeeded;
      if (therapyNeeded === true) {
        const therapistId = payload?.therapistId;
        if (therapistId && !mongoose.Types.ObjectId.isValid(therapistId)) {
          throw invalidTransition('Invalid therapistId', { therapistId });
        }
        return { toStatus: 'THERAPY', updates: therapistId ? { therapistId } : {} };
      }
      if (therapyNeeded === false) {
        return { toStatus: 'MONITORING', updates: {} };
      }
      throw invalidTransition('therapyNeeded must be boolean', { therapyNeeded });
    }

    case CASE_EVENTS.CLINICIAN_FINAL_EVALUATION_DECIDED: {
      if (!['REVIEW', 'DIAGNOSIS_READY', 'DIAGNOSIS'].includes(status)) {
        throw invalidTransition('Final evaluation decision is only valid in REVIEW/DIAGNOSIS stages', {
          from: status,
          eventType,
        });
      }
      const disposition = String(payload?.disposition || '').trim().toUpperCase();
      if (disposition === 'REFER_THERAPY') {
        // Gate for referral creation: clinician can create referral only when DIAGNOSIS_READY.
        return { toStatus: 'DIAGNOSIS_READY', updates: {} };
      }
      if (disposition === 'MONITORING') {
        return { toStatus: 'MONITORING', updates: {} };
      }
      throw invalidTransition('disposition must be MONITORING or REFER_THERAPY', { disposition });
    }

    case CASE_EVENTS.THERAPIST_ACCEPTS_CASE: {
      if (!['THERAPY', 'THERAPY_ACTIVE'].includes(status)) {
        throw invalidTransition('Therapist can only accept case in THERAPY', { from: status, eventType });
      }
      const therapistId = payload?.therapistId;
      if (therapistId && !mongoose.Types.ObjectId.isValid(therapistId)) {
        throw invalidTransition('Invalid therapistId', { therapistId });
      }
      return { toStatus: 'THERAPY_ACTIVE', updates: therapistId ? { therapistId } : {} };
    }

    case CASE_EVENTS.THERAPY_PROGRESS_COMPLETED: {
      if (!['THERAPY_ACTIVE'].includes(status)) {
        throw invalidTransition('Cannot complete therapy progress unless in THERAPY_ACTIVE', { from: status, eventType });
      }
      return { toStatus: 'MONITORING', updates: {} };
    }

    default:
      throw invalidTransition('Unknown case lifecycle event', { eventType });
  }
}

async function transitionCase({ caseId, parentId, childId, eventType, payload, triggeredBy }) {
  if (!eventType) throw invalidTransition('eventType is required');

  // CHILD_CREATED and an approved clinician appointment may arrive before any case exists (e.g. a child
  // added before cases were introduced), so both create the case on demand.
  const upsertEvents = [CASE_EVENTS.CHILD_CREATED, CASE_EVENTS.CLINICIAN_APPOINTMENT_BOOKED];
  const doc =
    upsertEvents.includes(eventType) && !caseId
      ? await ensureCaseExists({ parentId, childId, triggeredBy })
      : await loadCaseOrThrow({ caseId, parentId, childId });

  const fromStatusRaw = doc.status;
  const fromStatus = normalizeCaseStatus(fromStatusRaw || 'NEW') || 'NEW';
  if (!isValidStatus(fromStatus)) {
    throw invalidTransition('Case has unknown status', { fromStatus: fromStatusRaw, normalized: fromStatus });
  }

  const { toStatus, updates } = computeTransition({ currentStatus: fromStatus, eventType, payload });
  if (!isValidStatus(toStatus)) throw invalidTransition('Computed invalid toStatus', { toStatus });

  // Normalize persisted status even when "unchanged" (fixes legacy casing like "Review").
  doc.status = toStatus === fromStatus ? fromStatus : toStatus;

  if (updates && typeof updates === 'object') {
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'screeningProgress' && v && typeof v === 'object') {
        const existing = doc.screeningProgress && typeof doc.screeningProgress === 'object' ? doc.screeningProgress : {};
        doc.screeningProgress = { ...existing, ...v };
      } else {
        doc[k] = v;
      }
    }
  }

  doc.caseHistory = Array.isArray(doc.caseHistory) ? doc.caseHistory : [];
  doc.caseHistory.push({
    fromStatus,
    toStatus,
    event: String(eventType),
    context: payload && typeof payload === 'object' ? payload : undefined,
    timestamp: new Date(),
    triggeredBy: triggeredBy || null,
  });

  await doc.save();

  // First link to a clinician = registration with that clinician's organisation: issue the case file number.
  if (doc.clinicianId && !doc.fileNumber) {
    try {
      const numbered = await assignCaseFileNumber(doc._id, { clinicianId: doc.clinicianId });
      if (numbered) {
        doc.fileNumber = numbered.fileNumber;
        doc.organizationId = numbered.organizationId;
      }
    } catch (e) {
      console.error('[caseLifecycle] file number assignment failed:', e?.message || e);
    }
  }
  return doc;
}

module.exports = {
  CASE_EVENTS,
  CASE_LIFECYCLE_STATUS,
  transitionCase,
};

