const express = require('express');
const router = express.Router();
const {
  getCases,
  getCaseById,
  createCase,
  createFromAppointment,
  updateMrNumber,
} = require('../controllers/caseController');
const { protect, restrictTo } = require('../middleware/auth.middleware');

router.use(protect);
router.use(restrictTo('clinician'));

router.get('/', getCases);
router.post('/create', createCase);
router.post('/from-appointment', createFromAppointment);
router.get('/:id', getCaseById);
router.patch('/:id/mr-number', updateMrNumber);

module.exports = router;
