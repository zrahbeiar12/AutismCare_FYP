const express = require('express');
const router = express.Router();
const {
  createReferral,
  getReferralsByCase,
  getAssignedReferrals,
  acceptReferral,
  startReferral,
} = require('../controllers/referralController');
const { protect, restrictTo, requireOwnership } = require('../middleware/auth.middleware');
const { getReferralLetter } = require('../controllers/referralLetterController');
const { validateCaseState } = require('../middleware/validateCaseState');
const { ACTIONS } = require('../services/actionPermissionService');

router.use(protect);

// Clinician endpoints
router.post(
  '/',
  restrictTo('clinician'),
  validateCaseState({
    childCaseId: 'body.caseId',
    requiredStatuses: ['DIAGNOSIS_READY', 'THERAPY'],
    actionName: ACTIONS.CREATE_THERAPY_REFERRAL,
    message: 'Therapy referrals can only be created after lab reports are ready (DIAGNOSIS_READY).',
  }),
  createReferral
);
router.get('/case/:caseId', restrictTo('clinician'), requireOwnership({ caseIdParam: 'caseId' }), getReferralsByCase);

// Therapist endpoints
router.get('/assigned', restrictTo('therapist'), getAssignedReferrals);
router.patch('/:id/accept', restrictTo('therapist'), acceptReferral);
router.patch(
  '/:id/start',
  restrictTo('therapist'),
  // startReferral will load referral to get caseId; keep server-side guard in controller too
  startReferral
);

// Printable referral letter (PDF): referring clinician, therapist with case access, admin.
router.get('/:id/letter', restrictTo('clinician', 'therapist', 'admin'), getReferralLetter);

module.exports = router;
