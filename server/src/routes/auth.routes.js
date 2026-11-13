const { getCurrentTime, getCurrentTimeMs } = require('../utils/time.js');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const authController = require('../controllers/auth.controller.js');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Brute-force protection for public auth endpoints. Skipped in automated tests (NODE_ENV=test) unless a test
 * sets ENABLE_AUTH_RATE_LIMIT, so suites that log in many times keep working.
 */
const skipInTests = () => process.env.NODE_ENV === 'test' && !process.env.ENABLE_AUTH_RATE_LIMIT;
const tooMany = (message) => (req, res) => res.status(429).json({ success: false, message });

// Failed logins per IP + email: stops password guessing on one account without locking out a whole clinic network.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip || '')}|${String(req.body?.email || '').trim().toLowerCase()}`,
  handler: tooMany('Too many failed login attempts. Please wait 15 minutes and try again.'),
});
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: tooMany('Too many password reset requests. Please wait 15 minutes and try again.'),
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: tooMany('Too many sign-up attempts from this network. Please try again later.'),
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.resolve(__dirname, '../../uploads/documents');
    // Ensure directory exists
    const fs = require('fs');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = getCurrentTimeMs() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Public routes
router.post('/register', registerLimiter, upload.array('documents', 10), authController.register);
router.post('/login', loginLimiter, authController.login);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/forgot-password', passwordResetLimiter, authController.forgotPassword);
router.post('/reset-password/:token', passwordResetLimiter, authController.resetPassword);

module.exports = router;
