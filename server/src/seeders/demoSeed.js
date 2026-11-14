/**
 * Demo data for the expo / a fresh deployment: one complete case (Hamza Khan) from screening to therapy,
 * plus a second child waiting for the clinician, with one account per role.
 *
 * Safe to run on every start:
 *  - Questionnaires and activity templates are only created when missing.
 *  - The demo case is only created when the demo parent account does not exist yet; existing data is never
 *    changed or deleted.
 *
 * Runs at server start when SEED_DEMO_DATA=true (see server.js), or by hand: `npm run seed:demo`.
 * All demo accounts use DEMO_PASSWORD (required; at least 8 characters). Demo emails use example.com.
 */
const path = require('path');
const mongoose = require('mongoose');
const { User } = require('../models/User');
const { ChildCase } = require('../models/ChildCase');
const TherapyCase = require('../models/TherapyCase');
const TherapyPlan = require('../models/TherapyPlan');
const SessionLog = require('../models/SessionLog');
const { HomeAssignment } = require('../models/HomeAssignment');
const Submission = require('../models/Submission');
const Questionnaire = require('../models/Questionnaire');
const Activity = require('../models/Activity');
const LabApproval = require('../models/LabApproval');
const { Referral } = require('../models/Referral');
const { ClinicalEvaluation } = require('../models/ClinicalEvaluation');
const { Appointment } = require('../models/Appointment');
const { assignCaseFileNumber } = require('../services/caseFileNumberService');

const DEMO = {
  parent: 'parent@example.com',
  clinician: 'clinician@example.com',
  therapist: 'therapist@example.com',
  lab: 'lab@example.com',
  admin: 'admin@example.com',
};

const day = (n) => new Date(Date.now() - n * 864e5);

async function ensureReferenceData(log) {
  if (!(await Questionnaire.exists({ name: 'MCHAT-R' }))) {
    const mchat = require('./data/mchat.json');
    await Questionnaire.create({ name: 'MCHAT-R', domains: ['MCHAT'], questions: mchat.questions });
    log('M-CHAT-R questionnaire added');
  }
  if (!(await Questionnaire.exists({ name: 'ASQ-3' }))) {
    const asq = require('./data/asq.json');
    for (const iv of asq) {
      // eslint-disable-next-line no-await-in-loop
      await Questionnaire.create({
        name: 'ASQ-3',
        intervalMonths: iv.intervalMonths,
        minAgeDays: iv.minAgeDays,
        maxAgeDays: iv.maxAgeDays,
        domains: iv.domains,
        questions: iv.questions,
      });
    }
    log(`ASQ-3 questionnaires added (${asq.length} intervals)`);
  }
  if (!(await Activity.exists({ createdBy: null, isTemplate: true }))) {
    const { PLATFORM_SEEDS } = require('./seedActivityTemplates');
    for (const row of PLATFORM_SEEDS) {
      // eslint-disable-next-line no-await-in-loop
      await Activity.create({ ...row, isTemplate: true, createdBy: null });
    }
    log(`Activity library: ${PLATFORM_SEEDS.length} templates added`);
  }
}

async function makeUser(data, password) {
  const u = new User({ ...data, password, isEmailVerified: true, phoneNumber: data.phoneNumber || '+923001112200' });
  await u.save();
  return u;
}

async function seedDemoData({ log = console.log } = {}) {
  const password = String(process.env.DEMO_PASSWORD || '');
  if (password.length < 8) {
    log('[demo-seed] skipped: set DEMO_PASSWORD (8+ characters) to create the demo accounts');
    return { seeded: false };
  }

  await ensureReferenceData((m) => log(`[demo-seed] ${m}`));

  if (await User.exists({ email: DEMO.parent })) {
    log('[demo-seed] demo case already present — nothing to do');
    return { seeded: false };
  }

  const existingEmails = new Set(
    (await User.find({ email: { $in: Object.values(DEMO) } }).select('email').lean()).map((u) => u.email)
  );
  const getOrMake = async (email, data) =>
    existingEmails.has(email) ? User.findOne({ email }) : makeUser({ ...data, email }, password);

  const parent = await makeUser({ firstName: 'Ayesha', lastName: 'Khan', email: DEMO.parent, role: 'parent' }, password);
  const clinician = await getOrMake(DEMO.clinician, {
    firstName: 'Ali', lastName: 'Raza', role: 'clinician', specialization: 'Developmental Paediatrics', licenseNumber: 'DEMO-PMC-1001', approvalStatus: 'active',
  });
  const therapist = await getOrMake(DEMO.therapist, {
    firstName: 'Sara', lastName: 'Ahmed', role: 'therapist', specialization: 'Speech Therapist', licenseNumber: 'DEMO-TH-2001', approvalStatus: 'active',
  });
  const lab = await getOrMake(DEMO.lab, {
    firstName: 'City', lastName: 'Lab', role: 'lab', labName: 'City Diagnostic Lab', accreditation: 'ISO 15189',
  });
  await LabApproval.updateOne({ labUserId: lab._id }, { $set: { status: 'active' }, $setOnInsert: { labUserId: lab._id } }, { upsert: true });
  await getOrMake(DEMO.admin, { firstName: 'Admin', lastName: 'User', role: 'admin' });

  const dob1 = new Date(); dob1.setMonth(dob1.getMonth() - 30);
  const dob2 = new Date(); dob2.setMonth(dob2.getMonth() - 22);
  parent.children.push({ firstName: 'Hamza', lastName: 'Khan', dateOfBirth: dob1, gender: 'male', emergencyContact: 'Ayesha Khan', emergencyPhone: '03001234567' });
  parent.children.push({ firstName: 'Zara', lastName: 'Khan', dateOfBirth: dob2, gender: 'female', emergencyContact: 'Ayesha Khan', emergencyPhone: '03001234567' });
  await parent.save({ validateModifiedOnly: true });
  const [hamzaId, zaraId] = parent.children.slice(-2).map((c) => c._id);

  // ── Hamza: screened → evaluated → referred → in therapy with 4 scored sessions ──
  const hamza = await ChildCase.create({
    parentId: parent._id, childId: hamzaId, clinicianId: clinician._id, therapistId: therapist._id,
    status: 'THERAPY_ACTIVE', riskLevel: 'high', mrNumber: 'MR-DEMO-0451', createdAt: day(70),
  });
  await Submission.create([
    { childId: hamzaId, questionnaireType: 'MCHAT-R', scores: { totalScore: 9 }, result: 'Fail', riskLevel: 'high', createdAt: day(70) },
    {
      childId: hamzaId, questionnaireType: 'ASQ-3', intervalMonths: 30, result: 'Fail', riskLevel: 'high', createdAt: day(68),
      scores: {
        domainScores: { Communication: 20, 'Gross Motor': 50, 'Fine Motor': 45, 'Problem Solving': 31, 'Personal-Social': 40 },
        domainStatuses: {
          Communication: 'referral for further evaluation', 'Gross Motor': 'normal development', 'Fine Motor': 'normal development',
          'Problem Solving': 'need monitoring', 'Personal-Social': 'normal development',
        },
      },
    },
  ]);
  await Appointment.create({
    parent: parent._id, child: hamzaId, professional: clinician._id, professionalRole: 'clinician', appointmentType: 'DIAGNOSTIC',
    preferredDate: day(60), preferredTime: '10:00', finalDate: day(60), finalTime: '10:00', reason: 'High M-CHAT-R result', mode: 'IN_PERSON', status: 'COMPLETED',
  });
  await ClinicalEvaluation.create({
    caseId: hamza._id, clinicianId: clinician._id, status: 'FINALIZED', finalDisposition: 'REFER_THERAPY',
    diagnosis: { primary: 'Autism spectrum disorder', severityLevel: 'Level 1', confidence: 'moderate', rationale: 'DSM-5 criteria met; expressive language delay' },
    developmentalSummary: { summary: 'Expressive language delay; social reciprocity emerging' },
    observations: { tags: ['limited joint attention'], severity: 'mild', notes: 'Limited joint attention during play' },
    recommendations: { therapies: ['Speech therapy weekly'], followUp: 'Review in 3 months' },
  });
  await Referral.create({ caseId: hamza._id, clinicianId: clinician._id, therapistType: 'Speech Therapist', priority: 'high', notes: 'Focus on functional communication', status: 'ACCEPTED' });
  await TherapyCase.create({ caseId: hamza._id, therapistId: therapist._id, referralId: new mongoose.Types.ObjectId(), status: 'ACTIVE', startedAt: day(40) });
  await TherapyPlan.create({
    caseId: hamza._id, therapistId: therapist._id, domains: ['Speech', 'OT'], status: 'final', draft: false,
    longTermGoal: { title: 'Functional communication', description: 'Request and respond in daily routines', timeline: '12 weeks' },
    shortTermGoals: [
      { goalKey: 'req', title: 'Two-word requests', domain: 'Speech', status: 'Active', measurableCriteria: '4/5 trials', baseline: { value: 2 }, target: { value: 4 } },
      { goalKey: 'turn', title: 'Turn-taking in play', domain: 'OT', status: 'Active', measurableCriteria: '3 turns', baseline: { value: 2 }, target: { value: 4 } },
    ],
    activities: [{ title: 'Picture requests', description: 'Prompt and reinforce requests at snack time', linkedGoal: 'Two-word requests' }],
  });
  const ratings = [[2, 2], [3, 2], [3, 3], [4, 3]];
  for (let i = 0; i < ratings.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await SessionLog.create({
      caseId: hamza._id, therapistId: therapist._id, sessionDate: day(28 - i * 7), duration: 45, status: 'completed',
      goalsTargeted: ['Two-word requests', 'Turn-taking in play'],
      goalData: [
        { goalKey: 'req', measurementType: 'rating_1_5', rating: ratings[i][0] },
        { goalKey: 'turn', measurementType: 'rating_1_5', rating: ratings[i][1] },
      ],
      notes: `Session ${i + 1}: engaged well, needed fewer prompts`,
      parentInstructions: 'Practise two-word requests at meals',
    });
  }
  await HomeAssignment.create([
    { caseId: hamza._id, therapistId: therapist._id, title: 'Snack requests', instructions: 'Daily at snack time', dueDate: day(10), status: 'completed', therapistFeedback: { rating: 4 } },
    { caseId: hamza._id, therapistId: therapist._id, title: 'Picture book', instructions: 'Name 5 pictures daily', dueDate: day(-3), status: 'pending' },
  ]);
  await assignCaseFileNumber(hamza._id, { clinicianId: clinician._id });

  // ── Zara: screened (medium risk), appointment request waiting for the clinician ──
  const zara = await ChildCase.create({ parentId: parent._id, childId: zaraId, status: 'REVIEW', riskLevel: 'medium' });
  await Submission.create({ childId: zaraId, questionnaireType: 'MCHAT-R', scores: { totalScore: 5 }, result: 'Monitor', riskLevel: 'medium', createdAt: day(5) });
  await Appointment.create({
    parent: parent._id, child: zaraId, professional: clinician._id, professionalRole: 'clinician', appointmentType: 'DIAGNOSTIC',
    preferredDate: day(-5), preferredTime: '11:00', reason: 'M-CHAT-R medium risk', mode: 'IN_PERSON', status: 'PENDING', caseId: zara._id,
  });

  log(`[demo-seed] demo case created: Hamza Khan (${(await ChildCase.findById(hamza._id).lean()).fileNumber}) and Zara Khan`);
  return { seeded: true, caseIds: [String(hamza._id), String(zara._id)] };
}

module.exports = { seedDemoData, DEMO_EMAILS: DEMO };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const connectDB = require('../config/database');
  connectDB()
    .then(() => seedDemoData())
    .then(() => mongoose.disconnect())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
