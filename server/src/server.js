const { getCurrentTime, getCurrentTimeMs } = require('./utils/time.js');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const connectDB = require('./config/database.js');
const { verifySmtpOnStartup } = require('./services/emailService.js');

const app = express();

/* ─────────────────────────────────────────────
   1. Ensure upload directories exist
───────────────────────────────────────────── */
const uploadDirs = [
  'uploads/documents',
  'uploads/lab-reports',
  'uploads/appointment-documents',
  'uploads/home-assignments',
  'uploads/facial-screening',
  'uploads/reports',
];

uploadDirs.forEach(dir => {
  const fullPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

/* ─────────────────────────────────────────────
   2. Multer config
───────────────────────────────────────────── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads/documents/'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = getCurrentTimeMs() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});

/* ─────────────────────────────────────────────
   3. Middleware
───────────────────────────────────────────── */

const isProd = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: isProd
    ? (process.env.CLIENT_URL
        ? [process.env.CLIENT_URL]
        : ['http://localhost:4173', 'http://localhost:5173'])
    : true,
  credentials: true,
  // Lets the browser read the report PDF file name across origins (client and API are on different hosts).
  exposedHeaders: ['Content-Disposition'],
}));

app.use(express.json());
// Uploaded files are patient data: signed-in users only, and only files they may see (see uploadAccess.middleware).
const { protect: requireLogin } = require('./middleware/auth.middleware');
const { authorizeUploadAccess } = require('./middleware/uploadAccess.middleware');
app.use('/uploads', requireLogin, authorizeUploadAccess, express.static(path.join(process.cwd(), 'uploads'), { index: false, dotfiles: 'deny' }));

/* Rate limiter */
const messagingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/* ─────────────────────────────────────────────
   4. Routes
───────────────────────────────────────────── */
const authRoutes = require('./routes/auth.routes.js');
const adminRoutes = require('./routes/admin.routes.js');
const childRoutes = require('./routes/child.routes.js');
const screeningRoutes = require('./routes/screening.routes.js');
const labRoutes = require('./routes/lab.routes.js');
const labTestRoutes = require('./routes/labTestRoutes.js');
const labRequestRoutes = require('./routes/labRequestRoutes.js');
const notificationRoutes = require('./routes/notification.routes.js');
const appointmentRoutes = require('./routes/appointment.routes.js');
const therapistRoutes = require('./routes/therapist.routes.js');
const therapistCaseRoutes = require('./routes/therapistCaseRoutes.js');
const parentRoutes = require('./routes/parent.routes.js');
const clinicianRoutes = require('./routes/clinician.routes.js');
const caseRoutes = require('./routes/case.routes.js');
const evaluationRoutes = require('./routes/evaluation.routes.js');
const referralRoutes = require('./routes/referralRoutes.js');
const therapyRoutes = require('./routes/therapyRoutes.js');
const progressRoutes = require('./routes/progressRoutes.js');
const progressEngineRoutes = require('./routes/progressEngineRoutes.js');
const therapyPlanRoutes = require('./routes/therapyPlanRoutes.js');
const activityRoutes = require('./routes/activityRoutes.js');
const sessionRoutes = require('./routes/sessionRoutes.js');
const homeAssignmentRoutes = require('./routes/homeAssignmentRoutes.js');
const messageRoutes = require('./routes/messageRoutes.js');
const integrationRoutes = require('./routes/integrationRoutes.js');
const analyticsRoutes = require('./routes/analyticsRoutes.js');
const reportRoutes = require('./routes/reportRoutes.js');
const { scheduleRouter, sessionSlotRouter } = require('./routes/scheduleRoutes.js');
const facialScreeningRoutes = require('./routes/facialScreening.routes.js');
const clinicalIntelligenceRoutes = require('./routes/clinicalIntelligence.routes.js');

/* ─────────────────────────────────────────────
   5. Healthcheck (CRITICAL for Railway)
───────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    time: getCurrentTime().toISOString(),
  });
});

/* ─────────────────────────────────────────────
   6. Register routes
───────────────────────────────────────────── */
app.use("/api/auth", authRoutes);
app.use("/api/child", childRoutes);
app.use("/api/parent", parentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/screening", screeningRoutes);
app.use("/api/lab", labRoutes);
app.use("/api/lab-tests", labTestRoutes);
app.use("/api/lab-requests", labRequestRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/therapist", therapistRoutes);
app.use("/api/therapist", therapistCaseRoutes);
app.use("/api/clinician", clinicianRoutes);
app.use("/api/cases", caseRoutes);
app.use('/api/case', integrationRoutes);
app.use('/api/schedules', scheduleRouter);
app.use('/api/sessionslots', sessionSlotRouter);
app.use("/api/evaluations", evaluationRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/therapy", therapyRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/progress-engine", progressEngineRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/reports", reportRoutes);
app.use('/api/facial-screening', facialScreeningRoutes);
app.use("/api/therapy-plan", therapyPlanRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/assignments", homeAssignmentRoutes);
app.use('/api/messaging', messagingLimiter, messageRoutes);
app.use('/api', clinicalIntelligenceRoutes);

/* ─────────────────────────────────────────────
   7. Server + DB startup (FIXED FLOW)
───────────────────────────────────────────── */

const port = process.env.PORT || 8080;

/**
 * Start server ONLY after DB is connected
 */
const startServer = async () => {
  try {
    console.log('⏳ Connecting to MongoDB...');

    await connectDB();

    console.log('✅ MongoDB connected');

    // Demo data for the expo (only when SEED_DEMO_DATA=true; never changes existing records).
    if (String(process.env.SEED_DEMO_DATA || '').toLowerCase() === 'true') {
      try {
        const { seedDemoData } = require('./seeders/demoSeed.js');
        await seedDemoData();
      } catch (err) {
        console.error('[startup] demo seed failed:', err?.message || err);
      }
    }

    // Make sure the default organisation exists and every registered case has a sequential file number.
    try {
      const { getDefaultOrganization, backfillCaseFileNumbers } = require('./services/caseFileNumberService.js');
      await getDefaultOrganization();
      const numbered = await backfillCaseFileNumbers();
      if (numbered) console.log(`🗂️  Assigned file numbers to ${numbered} existing case(s)`);
    } catch (err) {
      console.error('[startup] case file numbering failed:', err?.message || err);
    }

    // Non-critical: best-effort SMTP verification (never crashes server)
    try {
      verifySmtpOnStartup();
    } catch (err) {
      console.error('[SMTP] SMTP_FAILED', err?.message || String(err));
    }

    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${port}`);
    });

    return server;

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

/* ─────────────────────────────────────────────
   8. Crash protection (important for Railway)
───────────────────────────────────────────── */
process.on('unhandledRejection', (err) => {
  console.error('🔥 Unhandled Rejection:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
  process.exit(1);
});

/* ─────────────────────────────────────────────
   9. Boot app
───────────────────────────────────────────── */
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };