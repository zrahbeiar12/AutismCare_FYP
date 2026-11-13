const { getCurrentTime, getCurrentTimeMs } = require('../utils/time.js');
const mongoose = require('mongoose');
const { Referral, THERAPIST_TYPES, REFERRAL_PRIORITY } = require('../models/Referral');
const { ChildCase } = require('../models/ChildCase');
const { ClinicalEvaluation } = require('../models/ClinicalEvaluation');
const { User } = require('../models/User');
const TherapyCase = require('../models/TherapyCase');
const SessionLog = require('../models/SessionLog');
const { createNotificationIfNotExists, createNotification } = require('../utils/notification');
const { NOTIFICATION_TYPES } = require('../models/Notification');
const { REFERRAL_STATUS, EVALUATION_STATUS, THERAPY_STATUS } = require('../constants/workflowEnums');
const { recordAuditEvent } = require('../utils/auditLog');
const { transitionCase, CASE_EVENTS } = require('../services/caseLifecycleService');
const { activateTherapyPlanWhenTherapyStarts } = require('../utils/therapyPlanLifecycle');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasAnyToken(haystack, tokens) {
  return tokens.some((token) => haystack.includes(token));
}

function therapistTypesFromSpecialization(specialization) {
  const value = normalizeText(specialization);
  if (!value) return [];

  const matches = [];

  // Direct canonical matches first (exact typed labels from admin/registration).
  if (value === normalizeText('Speech Therapist')) matches.push('Speech Therapist');
  if (value === normalizeText('Occupational Therapist')) matches.push('Occupational Therapist');
  if (value === normalizeText('Behavioral Therapist')) matches.push('Behavioral Therapist');
  if (value === normalizeText('AAC Specialist')) matches.push('AAC Specialist');
  if (value === normalizeText('PECS Specialist')) matches.push('PECS Specialist');

  // Fuzzy/synonym matches for free-text specialization values.
  if (hasAnyToken(value, ['speech', 'slp', 'language therapy', 'speech therapy'])) {
    matches.push('Speech Therapist');
  }
  if (hasAnyToken(value, ['occupational', 'occupational therapy', 'sensory integration', 'ot'])) {
    matches.push('Occupational Therapist');
  }
  if (hasAnyToken(value, ['behavioral', 'behavioural', 'behavior', 'behaviour', 'aba'])) {
    matches.push('Behavioral Therapist');
  }
  if (hasAnyToken(value, ['aac', 'augmentative', 'alternative communication'])) {
    matches.push('AAC Specialist');
  }
  if (hasAnyToken(value, ['pecs', 'picture exchange'])) {
    matches.push('PECS Specialist');
  }

  return [...new Set(matches)];
}

/** Notify therapists whose specialization matches the referral type. */
async function getTherapistUserIdsForReferralType(therapistType) {
  const therapists = await User.find({ role: 'therapist' }).select('_id specialization').lean();
  const ids = [];
  for (const t of therapists) {
    const types = therapistTypesFromSpecialization(t.specialization);
    if (types.includes(therapistType)) ids.push(t._id);
  }
  return ids;
}

async function resolveTherapistTypes(req) {
  // Prefer value on req.user when available.
  let specialization = req.user?.specialization;

  // In some environments/discriminator hydration flows, specialization may be missing on req.user.
  if (!specialization && req.user?._id) {
    const rawUser = await User.findById(req.user._id).select('specialization').lean();
    specialization = rawUser?.specialization;
  }

  return therapistTypesFromSpecialization(specialization);
}

async function mapCaseDetails(caseDoc) {
  const parent = await User.findById(caseDoc.parentId)
    .select('firstName lastName email children')
    .lean();

  let child = null;
  if (parent && Array.isArray(parent.children)) {
    const found = parent.children.find(
      (c) => c && c._id && c._id.toString() === caseDoc.childId.toString()
    );
    if (found) {
      child = {
        id: found._id,
        firstName: found.firstName || '',
        lastName: found.lastName || '',
        dateOfBirth: found.dateOfBirth || null,
        gender: found.gender || null,
      };
    }
  }

  return {
    caseId: caseDoc._id,
    // Case lifecycle status: the therapist Assigned Cases UI shows "Start therapy" only when this is THERAPY.
    status: caseDoc.status,
    child,
    parent: parent
      ? {
          id: parent._id,
          firstName: parent.firstName || '',
          lastName: parent.lastName || '',
          email: parent.email || '',
        }
      : null,
  };
}

/**
 * POST /api/referrals
 * Clinician creates referral. Requires at least one FINAL evaluation.
 */
exports.createReferral = async (req, res) => {
  try {
    const clinicianId = req.user._id;
    const { caseId, therapistType, priority, notes, specialists, diagnosis, childId } = req.body || {};

    // Compatibility: accept either the legacy referral payload:
    // { caseId, therapistType, priority, notes }
    // or CDSS-style payload:
    // { childId, diagnosis, notes, specialists[] } (caseId preferred when available)
    const specialistList = Array.isArray(specialists)
      ? specialists.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
      : [];

    // If CDSS payload is used, map to the first specialist + default priority.
    // (Frontend uses the legacy endpoint by creating one referral per specialist.)
    const effectiveTherapistType =
      therapistType ||
      (specialistList.length > 0 ? specialistList[0] : '');
    const effectivePriority = priority || 'medium';
    const effectiveCaseId = caseId;

    if (!effectiveCaseId || !effectiveTherapistType || !effectivePriority) {
      return res.status(400).json({
        success: false,
        message: 'caseId, therapistType and priority are required',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }
    if (!THERAPIST_TYPES.includes(effectiveTherapistType)) {
      return res.status(400).json({ success: false, message: 'Invalid therapistType' });
    }
    if (!REFERRAL_PRIORITY.includes(effectivePriority)) {
      return res.status(400).json({ success: false, message: 'Invalid priority' });
    }

    const caseDoc = await ChildCase.findOne({ _id: caseId, clinicianId });
    if (!caseDoc) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    const finalEval = await ClinicalEvaluation.findOne({
      caseId,
      clinicianId,
      status: EVALUATION_STATUS.FINALIZED,
    }).lean();
    if (!finalEval) {
      return res.status(400).json({
        success: false,
        message: 'Finalize clinical evaluation first',
        errorCode: 'EVALUATION_REQUIRED',
      });
    }

    const duplicateActive = await Referral.findOne({
      caseId,
      therapistType: effectiveTherapistType,
      status: { $in: [REFERRAL_STATUS.CREATED, REFERRAL_STATUS.SENT, REFERRAL_STATUS.ACCEPTED] },
    }).lean();

    if (duplicateActive) {
      return res.status(409).json({
        success: false,
        message: 'A referral for this therapist type already exists for this case',
      });
    }

    const created = await Referral.create({
      caseId,
      clinicianId,
      therapistType: effectiveTherapistType,
      priority: effectivePriority,
      notes: typeof notes === 'string' ? notes.trim() : '',
      status: REFERRAL_STATUS.CREATED,
    });

    // Lifecycle: clinician decision "therapy needed" => THERAPY (best-effort for legacy flows)
    try {
      await transitionCase({
        caseId,
        eventType: CASE_EVENTS.CLINICIAN_REVIEWS_REPORT,
        payload: { therapyNeeded: true },
        triggeredBy: clinicianId,
      });
    } catch (e) {
      console.error('[createReferral] case lifecycle transition skipped:', e?.message || e);
    }

    try {
      await recordAuditEvent({
        req,
        actorId: clinicianId,
        action: 'referral_created',
        entityType: 'Referral',
        entityId: created._id,
        caseId,
        summary: `${effectiveTherapistType} priority=${effectivePriority}`,
        after: { status: created.status, therapistType: created.therapistType, priority: created.priority },
      });
    } catch (e) {
      console.error('audit referral_created:', e);
    }

    try {
      const therapistIds = await getTherapistUserIdsForReferralType(effectiveTherapistType);
      for (const rid of therapistIds) {
        await createNotification({
          recipientId: rid,
          type: NOTIFICATION_TYPES.THERAPIST_NEW_REFERRAL,
          title: 'New referral assigned',
          message: `A new ${effectiveTherapistType} referral is available (priority: ${effectivePriority}).`,
          relatedResourceType: 'Referral',
          relatedResourceId: created._id,
          relatedCaseId: caseId,
        });
      }
    } catch (notifyErr) {
      console.error('createReferral notify:', notifyErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Referral created successfully',
      data: created,
      meta: {
        cdss: {
          childId: childId || null,
          diagnosis: diagnosis || null,
          specialists: specialistList,
        },
      },
    });
  } catch (error) {
    console.error('createReferral:', error);
    return res.status(500).json({ success: false, message: 'Failed to create referral' });
  }
};

/**
 * GET /api/referrals/case/:caseId
 * Clinician: all referrals for owned case.
 */
exports.getReferralsByCase = async (req, res) => {
  try {
    const clinicianId = req.user._id;
    const { caseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }

    const caseDoc = await ChildCase.findOne({ _id: caseId, clinicianId }).lean();
    if (!caseDoc) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    const list = await Referral.find({ caseId, clinicianId })
      .sort({ createdAt: -1 })
      .lean();

    const finalEvalExists = !!(await ClinicalEvaluation.findOne({
      caseId,
      clinicianId,
      status: EVALUATION_STATUS.FINALIZED,
    }).lean());

    return res.status(200).json({
      success: true,
      data: list,
      meta: { finalEvaluationExists: finalEvalExists },
    });
  } catch (error) {
    console.error('getReferralsByCase:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch referrals' });
  }
};

/**
 * GET /api/referrals/assigned
 * Therapist: referrals matching therapist specialization.
 */
exports.getAssignedReferrals = async (req, res) => {
  try {
    const therapistTypes = await resolveTherapistTypes(req);
    if (!therapistTypes.length) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: {
          therapistTypes: [],
          message: 'Therapist specialization is not mapped to a referral type',
        },
      });
    }

    const referrals = await Referral.find({ therapistType: { $in: therapistTypes } })
      .sort({ createdAt: -1 })
      .lean();

    const caseIds = [...new Set(referrals.map((r) => r.caseId.toString()))];
    const cases = await ChildCase.find({ _id: { $in: caseIds } }).lean();
    const caseMap = new Map(cases.map((c) => [c._id.toString(), c]));

    const therapistId = req.user._id;

    /** Referral row stays ACCEPTED in DB; TherapyCase ACTIVE means therapy has started — surface as in-progress for UI. */
    let activeTherapyCaseIds = new Set();
    if (caseIds.length > 0) {
      const caseObjectIds = caseIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      const activeRows = await TherapyCase.find({
        therapistId,
        caseId: { $in: caseObjectIds },
        status: THERAPY_STATUS.ACTIVE,
      })
        .select('caseId')
        .lean();
      activeTherapyCaseIds = new Set(activeRows.map((t) => String(t.caseId)));
    }

    let lastSessionByCaseId = new Map();
    if (caseIds.length > 0) {
      const caseObjectIds = caseIds.map((id) => new mongoose.Types.ObjectId(id));
      const lastAgg = await SessionLog.aggregate([
        {
          $match: {
            therapistId: new mongoose.Types.ObjectId(String(therapistId)),
            caseId: { $in: caseObjectIds },
          },
        },
        { $sort: { sessionDate: -1 } },
        {
          $group: {
            _id: '$caseId',
            lastSessionDate: { $first: '$sessionDate' },
          },
        },
      ]);
      lastSessionByCaseId = new Map(lastAgg.map((row) => [String(row._id), row.lastSessionDate]));
    }

    const toApiReferralStatus = (status) => {
      const v = String(status || '').trim().toUpperCase();
      if (v === REFERRAL_STATUS.CREATED) return 'pending';
      if (v === REFERRAL_STATUS.SENT) return 'sent';
      if (v === REFERRAL_STATUS.ACCEPTED) return 'accepted';
      if (v === REFERRAL_STATUS.REJECTED) return 'rejected';
      return String(status || '').trim().toLowerCase() || '';
    };

    const enriched = [];
    for (const ref of referrals) {
      const caseDoc = caseMap.get(ref.caseId.toString());
      if (!caseDoc) continue;
      const details = await mapCaseDetails(caseDoc);
      let status = toApiReferralStatus(ref.status);
      if (activeTherapyCaseIds.has(ref.caseId.toString())) {
        status = 'in-progress';
      }
      enriched.push({
        ...ref,
        status,
        case: details,
        lastSessionDate: lastSessionByCaseId.get(ref.caseId.toString()) || null,
      });
    }

    return res.status(200).json({
      success: true,
      data: enriched,
      meta: { therapistTypes },
    });
  } catch (error) {
    console.error('getAssignedReferrals:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch assigned referrals' });
  }
};

/**
 * PATCH /api/referrals/:id/accept
 * Therapist accepts referral: CREATED -> ACCEPTED
 */
exports.acceptReferral = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid referral id' });
    }

    const referral = await Referral.findById(id);
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found' });
    }

    const therapistTypes = await resolveTherapistTypes(req);
    if (!therapistTypes.length || !therapistTypes.includes(referral.therapistType)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this referral type' });
    }

    if (referral.status !== REFERRAL_STATUS.CREATED && referral.status !== REFERRAL_STATUS.SENT) {
      return res
        .status(400)
        .json({ success: false, message: 'Only CREATED/SENT referrals can be accepted' });
    }

    referral.status = REFERRAL_STATUS.ACCEPTED;
    await referral.save();

    try {
      await recordAuditEvent({
        req,
        actorId: req.user._id,
        action: 'referral_accepted',
        entityType: 'Referral',
        entityId: referral._id,
        caseId: referral.caseId,
        summary: 'Referral accepted by therapist',
        before: { status: REFERRAL_STATUS.CREATED },
        after: { status: referral.status },
      });
    } catch (e) {
      console.error('audit referral_accepted:', e);
    }

    const caseDoc = await ChildCase.findById(referral.caseId).select('clinicianId').lean();
    if (caseDoc?.clinicianId) {
      await createNotificationIfNotExists({
        recipientId: caseDoc.clinicianId,
        type: NOTIFICATION_TYPES.REFERRAL_ACCEPTED,
        title: 'Referral Accepted',
        message: 'Your referral has been accepted by therapist',
        relatedResourceType: 'Referral',
        relatedResourceId: referral._id,
      });
    }

    return res.status(200).json({ success: true, message: 'Referral accepted', data: referral });
  } catch (error) {
    console.error('acceptReferral:', error);
    return res.status(500).json({ success: false, message: 'Failed to accept referral' });
  }
};

/**
 * PATCH /api/referrals/:id/start
 * Therapist starts therapy: ACCEPTED -> (referral stays ACCEPTED); therapy case becomes ACTIVE
 */
exports.startReferral = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid referral id' });
    }

    const referral = await Referral.findById(id);
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found' });
    }

    // State gate: THERAPY only
    try {
      const { ChildCase } = require('../models/ChildCase');
      const caseDoc = await ChildCase.findById(referral.caseId).select('status').lean();
      const st = String(caseDoc?.status || '').toUpperCase();
      if (st !== 'THERAPY') {
        return res.status(403).json({
          success: false,
          message: 'Action not allowed in current case state',
          errorCode: 'CASE_STATE_FORBIDDEN',
          meta: { action: 'START_THERAPY', currentStatus: st, requiredStatuses: ['THERAPY'] },
        });
      }
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to validate case state' });
    }

    const therapistTypes = await resolveTherapistTypes(req);
    if (!therapistTypes.length || !therapistTypes.includes(referral.therapistType)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this referral type' });
    }

    if (referral.status !== REFERRAL_STATUS.ACCEPTED) {
      return res.status(400).json({ success: false, message: 'Only ACCEPTED referrals can start therapy' });
    }

    // Referral remains ACCEPTED; therapy lifecycle is tracked on TherapyCase.

    // Extend flow (without modifying referral schema): create/update therapy case activation record.
    const therapyCase = await TherapyCase.findOneAndUpdate(
      { caseId: referral.caseId, therapistId: req.user._id },
      {
        caseId: referral.caseId,
        therapistId: req.user._id,
        referralId: referral._id,
        status: THERAPY_STATUS.ACTIVE,
        startedAt: getCurrentTime(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    try {
      await activateTherapyPlanWhenTherapyStarts(referral.caseId, req.user._id);
    } catch (e) {
      console.error('[startReferral] activate therapy plan skipped:', e?.message || e);
    }

    // Lifecycle: therapist accepts/starts case => THERAPY_ACTIVE (best-effort for legacy flows)
    try {
      await transitionCase({
        caseId: referral.caseId,
        eventType: CASE_EVENTS.THERAPIST_ACCEPTS_CASE,
        payload: { therapistId: req.user._id },
        triggeredBy: req.user._id,
      });
    } catch (e) {
      console.error('[startReferral] case lifecycle transition skipped:', e?.message || e);
    }

    try {
      await recordAuditEvent({
        req,
        actorId: req.user._id,
        action: 'therapy_started',
        entityType: 'TherapyCase',
        entityId: therapyCase._id,
        caseId: referral.caseId,
        summary: `TherapyCase status=${THERAPY_STATUS.ACTIVE} from referral=${String(referral._id)}`,
        after: { status: THERAPY_STATUS.ACTIVE, referralId: String(referral._id) },
      });
    } catch (e) {
      console.error('audit therapy_started:', e);
    }

    // PATCH /api/referrals/:id/start and PATCH /api/therapist/referrals/:id/start-therapy both use this handler.
    return res.status(200).json({
      success: true,
      message: 'Therapy started',
      // API/UI expects a visible transition to "in-progress" once therapy begins.
      data: { ...referral.toJSON(), status: 'in-progress' },
      therapyCase,
      caseId: referral.caseId,
    });
  } catch (error) {
    console.error('startReferral:', error);
    return res.status(500).json({ success: false, message: 'Failed to start therapy' });
  }
};

/** Used by therapist case file aggregation (same matching rules as referrals). */
exports.resolveTherapistTypes = resolveTherapistTypes;
