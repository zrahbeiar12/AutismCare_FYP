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
const { ClinicalEvaluation } = require('../../src/models/ClinicalEvaluation');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser, authHeader } = require('../helpers/authHelpers');

describe('Clinical Evaluation Advanced Integration', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const emails = {
    parent: `parent.evaladv.${suffix}@test.com`,
    clinicianA: `cliniciana.evaladv.${suffix}@test.com`,
    clinicianB: `clinicianb.evaladv.${suffix}@test.com`,
  };

  let parentToken;
  let clinicianAToken;
  let clinicianBToken;
  let caseId;
  let evalId;

  beforeAll(async () => {
    await connectTestDb();

    await registerUser(app, {
      firstName: 'Parent',
      lastName: 'EvalAdv',
      email: emails.parent,
      password,
      role: 'parent',
    });

    await registerUser(app, {
      firstName: 'Clinician',
      lastName: 'A',
      email: emails.clinicianA,
      password,
      role: 'clinician',
      specialization: 'Pediatrics',
      licenseNumber: `EVAL-ADV-A-${suffix}`,
    });

    await registerUser(app, {
      firstName: 'Clinician',
      lastName: 'B',
      email: emails.clinicianB,
      password,
      role: 'clinician',
      specialization: 'Pediatrics',
      licenseNumber: `EVAL-ADV-B-${suffix}`,
    });

    await activateUser(emails.parent, { approvalStatus: 'active' });
    await activateUser(emails.clinicianA, { approvalStatus: 'active' });
    await activateUser(emails.clinicianB, { approvalStatus: 'active' });

    const parentLogin = await loginUser(app, emails.parent, password);
    const clinicianALogin = await loginUser(app, emails.clinicianA, password);
    const clinicianBLogin = await loginUser(app, emails.clinicianB, password);
    expect(parentLogin.statusCode).toBe(200);
    expect(clinicianALogin.statusCode).toBe(200);
    expect(clinicianBLogin.statusCode).toBe(200);

    parentToken = parentLogin.body.token;
    clinicianAToken = clinicianALogin.body.token;
    clinicianBToken = clinicianBLogin.body.token;

    const parentDoc = await User.findOne({ email: emails.parent });
    const clinicianA = await User.findOne({ email: emails.clinicianA }).lean();

    parentDoc.children.push({
      firstName: 'Eval',
      lastName: 'Kid',
      dateOfBirth: new Date('2023-08-20'),
      gender: 'male',
      emergencyContact: 'Parent EvalAdv',
      emergencyPhone: '03001230000',
    });
    await parentDoc.save({ validateModifiedOnly: true });
    const childId = String(parentDoc.children[parentDoc.children.length - 1]._id);

    const createdCase = await ChildCase.create({
      childId,
      parentId: parentDoc._id,
      clinicianId: new mongoose.Types.ObjectId(clinicianA._id),
      status: 'REVIEW',
    });
    caseId = String(createdCase._id);
  });

  afterAll(async () => {
    await ClinicalEvaluation.deleteMany({ caseId });
    await ChildCase.deleteMany({ _id: caseId });
    await User.deleteMany({ email: { $in: [emails.parent, emails.clinicianA, emails.clinicianB] } });
    await disconnectTestDb();
  });

  test('enforces create/list/version validation and ownership boundaries', async () => {
    const invalidCaseRes = await request(app)
      .post('/api/evaluations')
      .set(authHeader(clinicianAToken))
      .send({
        caseId: 'not-an-id',
        observations: 'obs',
        status: 'draft',
      });
    expect(invalidCaseRes.statusCode).toBe(400);

    const invalidStatusRes = await request(app)
      .post('/api/evaluations')
      .set(authHeader(clinicianAToken))
      .send({
        caseId,
        observations: 'obs',
        status: 'archived',
      });
    expect(invalidStatusRes.statusCode).toBe(400);

    const emptyPayloadRes = await request(app)
      .post('/api/evaluations')
      .set(authHeader(clinicianAToken))
      .send({
        caseId,
        observations: '   ',
        developmentalSummary: '',
        diagnosis: ' ',
        recommendations: ' ',
        comorbidConditions: ['  '],
        status: 'draft',
      });
    expect(emptyPayloadRes.statusCode).toBe(400);

    const createRes = await request(app)
      .post('/api/evaluations')
      .set(authHeader(clinicianAToken))
      .send({
        caseId,
        observations: 'Detailed observation for child behavior.',
        recommendations: 'Continue therapy and parent training.',
        status: 'draft',
      });
    expect(createRes.statusCode).toBe(201);
    evalId = String(createRes.body.data._id);

    const listByOtherClinicianRes = await request(app)
      .get(`/api/evaluations/${caseId}`)
      .set(authHeader(clinicianBToken));
    expect(listByOtherClinicianRes.statusCode).toBe(404);

    const invalidEvalIdRes = await request(app)
      .get('/api/evaluations/single/not-an-id')
      .set(authHeader(clinicianAToken));
    expect(invalidEvalIdRes.statusCode).toBe(400);

    const fetchByOtherClinicianRes = await request(app)
      .get(`/api/evaluations/single/${evalId}`)
      .set(authHeader(clinicianBToken));
    expect(fetchByOtherClinicianRes.statusCode).toBe(403);

    const invalidPatchIdRes = await request(app)
      .patch('/api/evaluations/not-an-id')
      .set(authHeader(clinicianAToken))
      .send({ status: 'draft' });
    expect(invalidPatchIdRes.statusCode).toBe(400);

    const invalidPatchStatusRes = await request(app)
      .patch(`/api/evaluations/${evalId}`)
      .set(authHeader(clinicianAToken))
      .send({ status: 'archived' });
    expect(invalidPatchStatusRes.statusCode).toBe(400);

    const patchByOtherClinicianRes = await request(app)
      .patch(`/api/evaluations/${evalId}`)
      .set(authHeader(clinicianBToken))
      .send({
        recommendations: 'Unauthorized update attempt',
        status: 'final',
        finalDisposition: 'MONITORING',
      });
    expect(patchByOtherClinicianRes.statusCode).toBe(403);

    const validPatchRes = await request(app)
      .patch(`/api/evaluations/${evalId}`)
      .set(authHeader(clinicianAToken))
      .send({
        diagnosis: 'ASD traits under observation',
        status: 'final',
        finalDisposition: 'MONITORING',
      });
    expect(validPatchRes.statusCode).toBe(201);
    expect(validPatchRes.body.data.status).toBe('final');
    expect(String(validPatchRes.body.data.sourceEvaluationId)).toBe(evalId);

    const parentBlockedRes = await request(app)
      .get(`/api/evaluations/${caseId}`)
      .set(authHeader(parentToken));
    expect(parentBlockedRes.statusCode).toBe(403);
  });
});