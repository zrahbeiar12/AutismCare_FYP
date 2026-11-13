const { getCurrentTime, getCurrentTimeMs } = require('../utils/time.js');
const express = require('express');
const { getPendingProfessionals, updateProfessionalStatus, getDashboardMetrics, listUsers, listOrganizations, createOrganization, setUserOrganization } = require('../controllers/admin.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();
const moderationThrottleState = new Map();

function adminModerationThrottle(req, res, next) {
	const windowMs = 60 * 1000;
	const maxInWindow = 8;
	const actor = String(req.user?._id || req.user?.id || 'unknown');
	const key = `${actor}:${req.ip || 'ip-unknown'}`;
	const now = getCurrentTimeMs();
	const prev = moderationThrottleState.get(key);

	if (!prev || now - prev.windowStart >= windowMs) {
		moderationThrottleState.set(key, { windowStart: now, count: 1 });
		return next();
	}

	if (prev.count >= maxInWindow) {
		return res.status(429).json({ message: 'Too many moderation requests, please try again later' });
	}

	prev.count += 1;
	moderationThrottleState.set(key, prev);
	return next();
}

router.use(protect);
router.use(restrictTo('admin'));

// Get all pending professionals
router.get('/pending-professionals', getPendingProfessionals);

router.get('/dashboard-metrics', getDashboardMetrics);

// User directory (admin User Management)
router.get('/users', listUsers);
router.put('/users/:id/organization', adminModerationThrottle, setUserOrganization);

// Organisations (hospitals / clinics) and their file-number codes
router.get('/organizations', listOrganizations);
router.post('/organizations', adminModerationThrottle, createOrganization);

// Update professional status (approve/reject)
router.post('/update-professional-status', adminModerationThrottle, updateProfessionalStatus);

module.exports = router;
