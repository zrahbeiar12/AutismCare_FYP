const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const {
  createEvaluation,
  getEvaluationsByCase,
  getEvaluationById,
  versionEvaluation,
  getDevelopmentSummaryByCase,
} = require('../controllers/evaluationController');
const { protect, restrictTo, requireOwnership } = require('../middleware/auth.middleware');
const { validateCaseState } = require('../middleware/validateCaseState');
const { ClinicalEvaluation } = require('../models/ClinicalEvaluation');

router.use(protect);
router.use(restrictTo('clinician'));

router.post(
  '/',
  validateCaseState({
    childCaseId: 'body.caseId',
    requiredStatuses: ['REVIEW', 'DIAGNOSIS', 'DIAGNOSIS_READY'],
    actionName: 'CREATE_EVALUATION',
    message: 'Clinical evaluation is only allowed during REVIEW/DIAGNOSIS stages.',
  }),
  createEvaluation
);
router.get('/single/:id', getEvaluationById);
router.get('/:caseId/development-summary', requireOwnership({ caseIdParam: 'caseId' }), getDevelopmentSummaryByCase);
// Use controller-owned ownership check so non-owners get 404 (no case existence leakage).
router.get('/:caseId', getEvaluationsByCase);
router.patch(
  '/:id',
  // Resolve caseId from evaluation id, then validate case state
  async (req, res, next) => {
    try {
      // Malformed ids would make findById throw a CastError (500); reject them as the controller does.
      if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
        return res.status(400).json({ success: false, message: 'Invalid evaluation id' });
      }
      const ev = await ClinicalEvaluation.findById(req.params.id).select('caseId').lean();
      req.body = req.body || {};
      if (ev?.caseId) req.body.caseId = String(ev.caseId);
      return next();
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to validate case state' });
    }
  },
  validateCaseState({
    childCaseId: 'body.caseId',
    requiredStatuses: ['REVIEW', 'DIAGNOSIS', 'DIAGNOSIS_READY'],
    actionName: 'UPDATE_EVALUATION',
    message: 'Clinical evaluation updates are only allowed during REVIEW/DIAGNOSIS stages.',
  }),
  versionEvaluation
);

module.exports = router;
