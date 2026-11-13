const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../../src/utils/email', () => {
  const sendEmail = jest.fn().mockResolvedValue(true);
  sendEmail.sendEmailWithAttachments = jest.fn().mockResolvedValue(true);
  return sendEmail;
});

const { app } = require('../../src/server');
const { User } = require('../../src/models/User');
const { ChildCase } = require('../../src/models/ChildCase');
const TherapyCase = require('../../src/models/TherapyCase');
const TherapyPlan = require('../../src/models/TherapyPlan');
const SessionLog = require('../../src/models/SessionLog');
const { HomeAssignment } = require('../../src/models/HomeAssignment');
const { Report } = require('../../src/models/Report');
const { ClinicalEvaluation } = require('../../src/models/ClinicalEvaluation');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser, authHeader } = require('../helpers/authHelpers');

describe('Reports Advanced Integration', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const emails = {
    parent: `parent.report.${suffix}@test.com`,
    parentOther: `parent.other.report.${suffix}@test.com`,
    clinician: `clinician.report.${suffix}@test.com`,
    therapist: `therapist.report.${suffix}@test.com`,
  };

  let parentToken;
  let parentOtherToken;
  let clinicianToken;
  let therapistToken;
  let parentId;
  let clinicianId;
  let therapistId;
  let caseId;
  let emptyCaseId;
  let parentReportId;
  let clinicianReportId;

  beforeAll(async () => {
    await connectTestDb();

    await registerUser(app, {
      firstName: 'Parent',
      lastName: 'Report',
      email: emails.parent,
      password,
      role: 'parent',
    });
    await registerUser(app, {
      firstName: 'Clinician',
      lastName: 'Report',
      email: emails.clinician,
      password,
      role: 'clinician',
      specialization: 'Pediatrics',
      licenseNumber: `R-C-${suffix}`,
    });
    await registerUser(app, {
      firstName: 'Other',
      lastName: 'Parent',
      email: emails.parentOther,
      password,
      role: 'parent',
    });
    await registerUser(app, {
      firstName: 'Therapist',
      lastName: 'Report',
      email: emails.therapist,
      password,
      role: 'therapist',
      specialization: 'Speech Therapist',
      licenseNumber: `R-T-${suffix}`,
    });

    await activateUser(emails.parent, { approvalStatus: 'active' });
    await activateUser(emails.parentOther, { approvalStatus: 'active' });
    await activateUser(emails.clinician, { approvalStatus: 'active' });
    await activateUser(emails.therapist, { approvalStatus: 'active' });

    const parentLogin = await loginUser(app, emails.parent, password);
    const parentOtherLogin = await loginUser(app, emails.parentOther, password);
    const clinicianLogin = await loginUser(app, emails.clinician, password);
    const therapistLogin = await loginUser(app, emails.therapist, password);
    expect(parentLogin.statusCode).toBe(200);
    expect(parentOtherLogin.statusCode).toBe(200);
    expect(clinicianLogin.statusCode).toBe(200);
    expect(therapistLogin.statusCode).toBe(200);
    parentToken = parentLogin.body.token;
    parentOtherToken = parentOtherLogin.body.token;
    clinicianToken = clinicianLogin.body.token;
    therapistToken = therapistLogin.body.token;

    const parentDoc = await User.findOne({ email: emails.parent });
    const clinicianDoc = await User.findOne({ email: emails.clinician });
    const therapistDoc = await User.findOne({ email: emails.therapist });
    parentId = String(parentDoc._id);
    clinicianId = String(clinicianDoc._id);
    therapistId = String(therapistDoc._id);

    parentDoc.children.push({
      firstName: 'Report',
      lastName: 'Child',
      dateOfBirth: new Date('2020-06-01'),
      gender: 'male',
      emergencyContact: 'Parent Report',
      emergencyPhone: '03001234567',
    });
    parentDoc.children.push({
      firstName: 'Report',
      lastName: 'Child Two',
      dateOfBirth: new Date('2020-08-20'),
      gender: 'female',
      emergencyContact: 'Parent Report',
      emergencyPhone: '03001234567',
    });
    await parentDoc.save({ validateModifiedOnly: true });

    const childId = String(parentDoc.children[parentDoc.children.length - 2]._id);
    const emptyChildId = String(parentDoc.children[parentDoc.children.length - 1]._id);

    const c = await ChildCase.create({
      childId,
      parentId,
      clinicianId,
    });
    caseId = String(c._id);

    const emptyCase = await ChildCase.create({
      childId: emptyChildId,
      parentId,
      clinicianId,
    });
    emptyCaseId = String(emptyCase._id);

    await TherapyCase.create({
      caseId,
      therapistId,
      referralId: new mongoose.Types.ObjectId(),
      status: 'active',
      startedAt: new Date(),
    });

    await TherapyCase.create({
      caseId: emptyCaseId,
      therapistId,
      referralId: new mongoose.Types.ObjectId(),
      status: 'active',
      startedAt: new Date(),
    });

    await TherapyPlan.create({
      caseId,
      therapistId,
      domains: ['Speech'],
      longTermGoal: {
        title: 'Improve expressive language',
        description: 'Use short requests with prompting',
        timeline: '12 weeks',
      },
      shortTermGoals: [
        {
          title: 'Use 2-word requests',
          measurableCriteria: '4/5 trials',
          domain: 'Speech',
          status: 'Active',
        },
      ],
      activities: [
        {
          title: 'Picture requests',
          description: 'Prompt and reinforce requests',
          linkedGoal: 'Use 2-word requests',
        },
      ],
      status: 'final',
      draft: false,
    });

    await SessionLog.create({
      caseId,
      therapistId,
      sessionDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      duration: 45,
      goalsTargeted: ['Use 2-word requests'],
      activitiesUsed: ['Picture requests'],
      childResponse: 'scale:4',
      notes: 'Steady engagement',
      parentInstructions: 'Practice request phrases daily',
      status: 'completed',
    });

    await HomeAssignment.create({
      caseId,
      therapistId,
      title: 'Request cards practice',
      instructions: 'Use at meal time',
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      status: 'pending',
    });

    await ClinicalEvaluation.create({
      caseId,
      clinicianId,
      observations: 'Mild communication delay',
      developmentalSummary: 'Needs structured language support',
      diagnosis: 'Language delay',
      recommendations: 'Continue weekly therapy',
      status: 'final',
    });
  });

  afterAll(async () => {
    if (caseId) {
      await Report.deleteMany({ caseId });
      if (emptyCaseId) await Report.deleteMany({ caseId: emptyCaseId });
      await ClinicalEvaluation.deleteMany({ caseId });
      await HomeAssignment.deleteMany({ caseId });
      await SessionLog.deleteMany({ caseId });
      await TherapyPlan.deleteMany({ caseId });
      await TherapyCase.deleteMany({ caseId: { $in: [caseId, emptyCaseId].filter(Boolean) } });
      await ChildCase.deleteMany({ _id: { $in: [caseId, emptyCaseId].filter(Boolean) } });
    }
    await User.deleteMany({ email: { $in: [emails.parent, emails.parentOther, emails.clinician, emails.therapist] } });
    await disconnectTestDb();
  });

  test('generates report variants and enforces role-based listing/viewing', async () => {
    const parentReportRes = await request(app)
      .post('/api/reports/generate')
      .set(authHeader(therapistToken))
      .send({ caseId, reportType: 'parent' });
    expect(parentReportRes.statusCode).toBe(201);
    parentReportId = String(parentReportRes.body.data.reportId);

    const clinicianReportRes = await request(app)
      .post('/api/reports')
      .set(authHeader(therapistToken))
      .send({ caseId, type: 'clinician' });
    expect(clinicianReportRes.statusCode).toBe(201);
    clinicianReportId = String(clinicianReportRes.body.data.reportId);

    const aliasTypeRes = await request(app)
      .post('/api/reports/generate')
      .set(authHeader(therapistToken))
      .send({ caseId, reportType: 'session-summary' });
    expect(aliasTypeRes.statusCode).toBe(201);
    expect(aliasTypeRes.body.data.type).toBe('session');
    expect(aliasTypeRes.body.data.data.schema).toBe('standard-v1');
    expect(aliasTypeRes.body.data.data.stats.sessionsCompleted).toBe(1);
    expect(aliasTypeRes.body.data.data.audience.recentSessions).toHaveLength(1);

    const therapyTypeRes = await request(app)
      .post('/api/reports/generate')
      .set(authHeader(therapistToken))
      .send({ caseId, reportType: 'therapy-report' });
    expect(therapyTypeRes.statusCode).toBe(201);
    expect(therapyTypeRes.body.data.data.audience.kind).toBe('therapy');
    expect(therapyTypeRes.body.data.data.audience.activities[0].title).toBe('Picture requests');
    expect(therapyTypeRes.body.data.data.goals.map((g) => g.name)).toEqual(['Use 2-word requests']);

    const duplicateRes = await request(app)
      .post('/api/reports/generate')
      .set(authHeader(therapistToken))
      .send({ caseId, reportType: 'parent' });
    expect(duplicateRes.statusCode).toBe(200);
    expect(duplicateRes.body.data.duplicate).toBe(true);

    const therapistListRes = await request(app)
      .get('/api/reports')
      .set(authHeader(therapistToken));
    expect(therapistListRes.statusCode).toBe(200);
    expect(therapistListRes.body.data.length).toBeGreaterThanOrEqual(3);

    const therapistFilteredRes = await request(app)
      .get('/api/reports?type=session-summary')
      .set(authHeader(therapistToken));
    expect(therapistFilteredRes.statusCode).toBe(200);
    expect(therapistFilteredRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(therapistFilteredRes.body.data.every((r) => r.type === 'session')).toBe(true);

    const invalidTypeFilterRes = await request(app)
      .get('/api/reports?type=unknown')
      .set(authHeader(therapistToken));
    expect(invalidTypeFilterRes.statusCode).toBe(400);

    const invalidDateFilterRes = await request(app)
      .get('/api/reports?from=not-a-date')
      .set(authHeader(therapistToken));
    expect(invalidDateFilterRes.statusCode).toBe(400);

    const parentListRes = await request(app)
      .get(`/api/reports/${caseId}`)
      .set(authHeader(parentToken));
    expect(parentListRes.statusCode).toBe(200);
    expect(parentListRes.body.data.every((r) => r.type === 'parent')).toBe(true);

    const clinicianListRes = await request(app)
      .get(`/api/reports/${caseId}`)
      .set(authHeader(clinicianToken));
    expect(clinicianListRes.statusCode).toBe(200);
    expect(clinicianListRes.body.data.every((r) => r.type === 'clinician')).toBe(true);

    const parentViewOwnRes = await request(app)
      .get(`/api/reports/view/${parentReportId}`)
      .set(authHeader(parentToken));
    expect(parentViewOwnRes.statusCode).toBe(200);
    expect(parentViewOwnRes.body.data.type).toBe('parent');
    expect(typeof parentViewOwnRes.body.data.data.summary).toBe('string');
    expect(parentViewOwnRes.body.data.data.audience.kind).toBe('parent');

    const parentViewClinicianRes = await request(app)
      .get(`/api/reports/view/${clinicianReportId}`)
      .set(authHeader(parentToken));
    expect(parentViewClinicianRes.statusCode).toBe(403);

    const therapistViewClinicianRes = await request(app)
      .get(`/api/reports/view/${clinicianReportId}`)
      .set(authHeader(therapistToken));
    expect(therapistViewClinicianRes.statusCode).toBe(200);

    const parentGlobalListRes = await request(app)
      .get('/api/reports')
      .set(authHeader(parentToken));
    expect(parentGlobalListRes.statusCode).toBe(403);

    const otherParentCaseListRes = await request(app)
      .get(`/api/reports/${caseId}`)
      .set(authHeader(parentOtherToken));
    expect(otherParentCaseListRes.statusCode).toBe(403);

    const invalidViewIdRes = await request(app)
      .get('/api/reports/view/not-an-id')
      .set(authHeader(therapistToken));
    expect(invalidViewIdRes.statusCode).toBe(400);

    const insufficientDataRes = await request(app)
      .post('/api/reports/generate')
      .set(authHeader(therapistToken))
      .send({ caseId: emptyCaseId, reportType: 'progress-report' });
    expect(insufficientDataRes.statusCode).toBe(201);
    expect(insufficientDataRes.body.data.type).toBe('progress');
    expect(insufficientDataRes.body.data.data.insufficientData).toBe(true);
    expect(insufficientDataRes.body.data.data.stats.overallProgressPct).toBeNull();
    expect(insufficientDataRes.body.data.data.stats.sessionsCompleted).toBe(0);
  });
});