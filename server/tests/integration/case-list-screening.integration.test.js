const request = require('supertest');

jest.mock('../../src/utils/email', () => {
  const sendEmail = jest.fn().mockResolvedValue(true);
  sendEmail.sendEmailWithAttachments = jest.fn().mockResolvedValue(true);
  return sendEmail;
});

const { app } = require('../../src/server');
const { User } = require('../../src/models/User');
const { ChildCase } = require('../../src/models/ChildCase');
const Questionnaire = require('../../src/models/Questionnaire');
const Submission = require('../../src/models/Submission');
const mchatData = require('../../src/seeders/data/mchat.json');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser, authHeader } = require('../helpers/authHelpers');

/**
 * Clinician "Case directory" (GET /api/cases): every assigned case is listed, with correct child details,
 * the latest M-CHAT-R score and the latest ASQ-3 result per domain, and a risk that combines both.
 */
describe('Clinician case list — child details, screening results, list placement', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const emails = {
    parent: `parent.caselist.${suffix}@test.com`,
    clinician: `clinician.caselist.${suffix}@test.com`,
  };

  const ASQ_DOMAINS = ['Communication', 'Gross Motor', 'Fine Motor', 'Problem Solving', 'Personal-Social'];
  const ASQ_PREFIX = { Communication: 'C', 'Gross Motor': 'GM', 'Fine Motor': 'FM', 'Problem Solving': 'PS', 'Personal-Social': 'PSO' };
  const asqQuestions = ASQ_DOMAINS.flatMap((domain) =>
    Array.from({ length: 6 }).map((_, i) => ({
      questionId: `${ASQ_PREFIX[domain]}${i + 1}`,
      text: `${domain} item ${i + 1}`,
      domain,
    }))
  );

  let parentToken;
  let clinicianToken;
  let parentId;
  let clinicianId;
  const children = {}; // name -> { childId, caseId }

  const twoYearsAgo = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 24);
    return d.toISOString().slice(0, 10);
  };
  const futureDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  };

  /** Every M-CHAT-R item answered the "at risk" way → score 20/20, high risk. */
  const mchatAllElevated = () =>
    mchatData.questions.map((q) => ({ questionId: q.questionId, answer: q.reverseScored ? 'yes' : 'no' }));
  /** Every M-CHAT-R item answered the typical way → score 0, low risk. */
  const mchatAllTypical = () =>
    mchatData.questions.map((q) => ({ questionId: q.questionId, answer: q.reverseScored ? 'no' : 'yes' }));

  /** answersByDomain: { Communication: ['yes', ...6], ... }; missing domains default to all "yes". */
  const asqResponses = (answersByDomain = {}) =>
    ASQ_DOMAINS.flatMap((domain) => {
      const answers = answersByDomain[domain] || Array(6).fill('yes');
      return answers.map((answer, i) => ({ questionId: `${ASQ_PREFIX[domain]}${i + 1}`, answer }));
    });

  async function addChild(firstName, gender) {
    const res = await request(app)
      .post('/api/child')
      .set(authHeader(parentToken))
      .send({
        firstName,
        lastName: 'Case',
        dateOfBirth: twoYearsAgo(),
        gender,
        emergencyContact: 'Parent Caselist',
        emergencyPhone: '03001230000',
      });
    expect(res.statusCode).toBe(201);
    const childId = String(res.body.data.id || res.body.data._id);
    const doc = await ChildCase.findOne({ parentId, childId }).lean();
    children[firstName] = { childId, caseId: doc ? String(doc._id) : null };
    return childId;
  }

  async function submit(childId, body) {
    const res = await request(app)
      .post('/api/screening/calculate-screening')
      .set(authHeader(parentToken))
      .send({ childId, ...body });
    expect(res.statusCode).toBe(201);
    return res.body.data;
  }

  async function bookAndApprove(name) {
    const { childId, caseId } = children[name];
    const create = await request(app)
      .post('/api/appointments')
      .set(authHeader(parentToken))
      .send({
        caseId,
        childId,
        appointmentType: 'DIAGNOSTIC',
        professionalId: clinicianId,
        preferredDate: futureDate(),
        preferredTime: name === 'Amna' ? '10:00' : '11:00',
        reason: 'Screening follow-up',
        mode: 'IN_PERSON',
      });
    expect(create.statusCode).toBe(201);
    const apptId = String(create.body.data._id);
    const approve = await request(app)
      .put(`/api/appointments/${apptId}/approve`)
      .set(authHeader(clinicianToken))
      .send({});
    expect(approve.statusCode).toBe(200);
    expect(approve.body.childCaseSyncWarning).toBeFalsy();
  }

  async function listCases(query = '') {
    const res = await request(app).get(`/api/cases${query}`).set(authHeader(clinicianToken));
    expect(res.statusCode).toBe(200);
    return res.body.data;
  }

  beforeAll(async () => {
    await connectTestDb();

    await Questionnaire.deleteMany({ name: { $in: ['MCHAT-R', 'ASQ-3'] } });
    await Questionnaire.create({ name: 'MCHAT-R', domains: ['MCHAT'], questions: mchatData.questions });
    await Questionnaire.create({ name: 'ASQ-3', intervalMonths: 24, domains: ASQ_DOMAINS, questions: asqQuestions });

    await registerUser(app, { firstName: 'Parent', lastName: 'Caselist', email: emails.parent, password, role: 'parent' });
    await registerUser(app, {
      firstName: 'Clinician',
      lastName: 'Caselist',
      email: emails.clinician,
      password,
      role: 'clinician',
      specialization: 'Pediatrics',
      licenseNumber: `CL-${suffix}`,
    });
    await activateUser(emails.parent, { approvalStatus: 'active' });
    await activateUser(emails.clinician, { approvalStatus: 'active' });

    parentToken = (await loginUser(app, emails.parent, password)).body.token;
    clinicianToken = (await loginUser(app, emails.clinician, password)).body.token;
    parentId = String((await User.findOne({ email: emails.parent }))._id);
    clinicianId = String((await User.findOne({ email: emails.clinician }))._id);
  });

  afterAll(async () => {
    const childIds = Object.values(children).map((c) => c.childId);
    await Submission.deleteMany({ childId: { $in: childIds } });
    await ChildCase.deleteMany({ parentId });
    await Questionnaire.deleteMany({ name: { $in: ['MCHAT-R', 'ASQ-3'] } });
    await User.deleteMany({ email: { $in: Object.values(emails) } });
    await disconnectTestDb();
  });

  test('a later ASQ-3 pass does not downgrade a high-risk M-CHAT-R; list shows child details and both results', async () => {
    const childId = await addChild('Amna', 'female');
    const mchat = await submit(childId, { questionnaireType: 'MCHAT-R', responses: mchatAllElevated() });
    expect(mchat.riskLevel).toBe('high');
    const asq = await submit(childId, { questionnaireType: 'ASQ-3', intervalMonths: 24, responses: asqResponses() });
    expect(asq.result).toBe('Pass');

    // Stored case risk combines both questionnaires.
    const stored = await ChildCase.findById(children.Amna.caseId).lean();
    expect(stored.status).toBe('REVIEW');
    expect(stored.riskLevel).toBe('high');
    expect(stored.screeningSummary.overallRisk).toBe('high');

    await bookAndApprove('Amna');

    const rows = await listCases();
    const row = rows.find((r) => String(r.childId) === childId);
    expect(row).toBeTruthy();
    expect(row.childName).toBe('Amna Case');
    expect(row.child.gender).toBe('female');
    expect(row.child.ageMonths).toBeGreaterThanOrEqual(23);
    expect(row.child.ageMonths).toBeLessThanOrEqual(24);
    expect(row.status).toBe('REVIEW');
    expect(row.riskLevel).toBe('high');

    expect(row.screenings.mchat).toMatchObject({ totalScore: 20, maxScore: 20, result: 'Fail', riskLevel: 'high' });
    expect(row.screenings.asq3.intervalMonths).toBe(24);
    expect(row.screenings.asq3.result).toBe('Pass');
    expect(row.screenings.asq3.domains.map((d) => d.domain)).toEqual(ASQ_DOMAINS);
    for (const d of row.screenings.asq3.domains) {
      expect(d.score).toBe(60);
      expect(d.zone).toBe('ok');
      expect(typeof d.referralCutoff).toBe('number');
    }
  });

  test('ASQ-3 domains report their own zone (refer / monitor / ok) against the interval cutoffs', async () => {
    const childId = await addChild('Bilal', 'male');
    // 24-month cutoffs: Communication referral 25 → 20 refers; Gross Motor referral 38 / monitor 41 → 40 monitors.
    await submit(childId, {
      questionnaireType: 'ASQ-3',
      intervalMonths: 24,
      responses: asqResponses({
        Communication: ['yes', 'yes', 'not-yet', 'not-yet', 'not-yet', 'not-yet'],
        'Gross Motor': ['yes', 'yes', 'yes', 'yes', 'not-yet', 'not-yet'],
      }),
    });
    await bookAndApprove('Bilal');

    const row = (await listCases()).find((r) => String(r.childId) === childId);
    const byDomain = Object.fromEntries(row.screenings.asq3.domains.map((d) => [d.domain, d]));
    expect(byDomain.Communication).toMatchObject({ score: 20, zone: 'refer', referralCutoff: 25 });
    expect(byDomain['Gross Motor']).toMatchObject({ score: 40, zone: 'monitor', referralCutoff: 38 });
    expect(byDomain['Fine Motor'].zone).toBe('ok');
    expect(row.screenings.asq3.result).toBe('Fail');
    expect(row.screenings.mchat).toBeNull();
    expect(row.riskLevel).toBe('high');
  });

  test('a case the clinician creates before any screening is listed (status NEW, risk unknown, no results)', async () => {
    const childId = await addChild('Sana', 'female');
    const res = await request(app)
      .post('/api/cases/create')
      .set(authHeader(clinicianToken))
      .send({ parentId, childId });
    expect([200, 201]).toContain(res.statusCode);

    const row = (await listCases()).find((r) => String(r.childId) === childId);
    expect(row).toBeTruthy();
    expect(row.status).toBe('NEW');
    expect(row.riskLevel).toBe('unknown');
    expect(row.screenings).toEqual({ mchat: null, asq3: null });

    const newOnly = await listCases('?status=NEW');
    expect(newOnly.map((r) => String(r.childId))).toEqual([childId]);
  });

  test('risk and status filters return the right cases', async () => {
    const high = await listCases('?riskLevel=high');
    expect(high.map((r) => r.childName).sort()).toEqual(['Amna Case', 'Bilal Case']);

    const review = await listCases('?status=REVIEW');
    expect(review.map((r) => r.childName).sort()).toEqual(['Amna Case', 'Bilal Case']);

    expect(await listCases('?status=THERAPY')).toEqual([]);
  });

  test('both clinician lists (case directory and active caseload) contain the same cases', async () => {
    const directory = await listCases();
    const caseload = await request(app).get('/api/clinician/caseload-progress').set(authHeader(clinicianToken));
    expect(caseload.statusCode).toBe(200);
    const caseloadIds = caseload.body.data.cases.map((c) => String(c.caseId)).sort();
    expect(caseloadIds).toEqual(directory.map((r) => String(r._id)).sort());
  });

  test('a rescreen while the case is in therapy refreshes the listed results without moving the case', async () => {
    const { childId, caseId } = children.Amna;
    await ChildCase.findByIdAndUpdate(caseId, { $set: { status: 'THERAPY' } });

    await submit(childId, { questionnaireType: 'MCHAT-R', responses: mchatAllTypical() });

    const stored = await ChildCase.findById(caseId).lean();
    expect(stored.status).toBe('THERAPY');
    expect(stored.riskLevel).toBe('low');
    expect(stored.screeningSummary.latestByType.mchat.totalScore).toBe(0);

    const row = (await listCases('?status=THERAPY')).find((r) => String(r.childId) === childId);
    expect(row.screenings.mchat).toMatchObject({ totalScore: 0, riskLevel: 'low' });
    expect(row.riskLevel).toBe('low');
  });
});
