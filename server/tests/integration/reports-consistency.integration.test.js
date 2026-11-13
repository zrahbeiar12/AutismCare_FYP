const fs = require('fs');
const path = require('path');
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
const Submission = require('../../src/models/Submission');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser, authHeader } = require('../helpers/authHelpers');

/**
 * Every role must see the same numbers for the same child: all report types share one core, and the in-app
 * progress views (parent case panel, clinician overview + caseload, therapist analytics) agree with it.
 */
describe('Reports — same numbers for parent, clinician and therapist', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const emails = {
    parent: `parent.rcons.${suffix}@test.com`,
    clinician: `clinician.rcons.${suffix}@test.com`,
    therapist: `therapist.rcons.${suffix}@test.com`,
    therapist2: `therapist2.rcons.${suffix}@test.com`,
  };
  const tokens = {};
  const ids = {};
  const reports = {};

  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    await connectTestDb();

    await registerUser(app, { firstName: 'Ayesha', lastName: 'Khan', email: emails.parent, password, role: 'parent' });
    await registerUser(app, {
      firstName: 'Ali',
      lastName: 'Raza',
      email: emails.clinician,
      password,
      role: 'clinician',
      specialization: 'Pediatrics',
      licenseNumber: `RC-${suffix}`,
    });
    for (const [key, first] of [
      ['therapist', 'Sara'],
      ['therapist2', 'Omar'],
    ]) {
      await registerUser(app, {
        firstName: first,
        lastName: 'Therapist',
        email: emails[key],
        password,
        role: 'therapist',
        specialization: 'Speech Therapist',
        licenseNumber: `RT-${key}-${suffix}`,
      });
    }
    for (const e of Object.values(emails)) await activateUser(e, { approvalStatus: 'active' });
    for (const [k, e] of Object.entries(emails)) tokens[k] = (await loginUser(app, e, password)).body.token;
    for (const [k, e] of Object.entries(emails)) ids[k] = String((await User.findOne({ email: e }))._id);

    const parentDoc = await User.findOne({ email: emails.parent });
    const dob = new Date();
    dob.setMonth(dob.getMonth() - 30);
    parentDoc.children.push({
      firstName: 'Hamza',
      lastName: 'Khan',
      dateOfBirth: dob,
      gender: 'male',
      emergencyContact: 'Ayesha Khan',
      emergencyPhone: '03001234567',
    });
    await parentDoc.save({ validateModifiedOnly: true });
    ids.child = String(parentDoc.children[parentDoc.children.length - 1]._id);

    const c = await ChildCase.create({
      childId: ids.child,
      parentId: ids.parent,
      clinicianId: ids.clinician,
      therapistId: ids.therapist,
      status: 'THERAPY_ACTIVE',
      riskLevel: 'high',
    });
    ids.case = String(c._id);

    for (const t of ['therapist', 'therapist2']) {
      await TherapyCase.create({
        caseId: ids.case,
        therapistId: ids[t],
        referralId: new mongoose.Types.ObjectId(),
        status: 'ACTIVE',
        startedAt: daysAgo(40),
      });
    }

    await TherapyPlan.create({
      caseId: ids.case,
      therapistId: ids.therapist,
      domains: ['Speech', 'OT'],
      longTermGoal: { title: 'Functional communication', description: 'Request and respond in daily routines', timeline: '12 weeks' },
      shortTermGoals: [
        { goalKey: 'req', title: 'Two-word requests', domain: 'Speech', status: 'Active', measurableCriteria: '4/5 trials', baseline: { value: 2 }, target: { value: 4 } },
        { goalKey: 'turn', title: 'Turn-taking in play', domain: 'OT', status: 'Active', measurableCriteria: '3 turns', baseline: { value: 2 }, target: { value: 4 } },
      ],
      activities: [{ title: 'Picture requests', description: 'Prompt and reinforce requests at snack time', linkedGoal: 'Two-word requests' }],
      status: 'final',
      draft: false,
    });

    // Primary therapist: four scored sessions trending up, one missed session.
    const ratings = [
      [2, 2],
      [3, 2],
      [3, 3],
      [4, 3],
    ];
    for (let i = 0; i < ratings.length; i += 1) {
      await SessionLog.create({
        caseId: ids.case,
        therapistId: ids.therapist,
        sessionDate: daysAgo(28 - i * 7),
        duration: 45,
        status: 'completed',
        goalsTargeted: ['Two-word requests', 'Turn-taking in play'],
        goalData: [
          { goalKey: 'req', measurementType: 'rating_1_5', rating: ratings[i][0] },
          { goalKey: 'turn', measurementType: 'rating_1_5', rating: ratings[i][1] },
        ],
        notes: `Session ${i + 1}: engaged well`,
        parentInstructions: 'Practise two-word requests at meals',
      });
    }
    await SessionLog.create({ caseId: ids.case, therapistId: ids.therapist, sessionDate: daysAgo(3), duration: 45, status: 'missed', parentInstructions: 'Session missed' });

    // A second therapist on the same case with poor, unrelated scores: must not leak into the case-wide figures.
    for (let i = 0; i < 3; i += 1) {
      await SessionLog.create({
        caseId: ids.case,
        therapistId: ids.therapist2,
        sessionDate: daysAgo(20 - i * 5),
        duration: 30,
        status: 'completed',
        childResponse: 'scale:1',
        parentInstructions: 'Practise sounds',
      });
    }

    await HomeAssignment.create([
      { caseId: ids.case, therapistId: ids.therapist, title: 'Snack requests', instructions: 'Daily', dueDate: daysAgo(10), status: 'completed', therapistFeedback: { rating: 4 } },
      { caseId: ids.case, therapistId: ids.therapist, title: 'Turn games', instructions: 'Daily', dueDate: daysAgo(4), status: 'completed', therapistFeedback: { rating: 3 } },
      { caseId: ids.case, therapistId: ids.therapist, title: 'Picture book', instructions: 'Daily', dueDate: daysAgo(-3), status: 'pending' },
    ]);

    await Submission.create([
      { childId: ids.child, questionnaireType: 'MCHAT-R', scores: { totalScore: 9 }, result: 'Fail', riskLevel: 'high', createdAt: daysAgo(60) },
      {
        childId: ids.child,
        questionnaireType: 'ASQ-3',
        intervalMonths: 30,
        scores: {
          totalScore: null,
          domainScores: { Communication: 20, 'Gross Motor': 50, 'Fine Motor': 45, 'Problem Solving': 31, 'Personal-Social': 40 },
          domainStatuses: {
            Communication: 'referral for further evaluation',
            'Gross Motor': 'normal development',
            'Fine Motor': 'normal development',
            'Problem Solving': 'need monitoring',
            'Personal-Social': 'normal development',
          },
        },
        result: 'Fail',
        riskLevel: 'high',
        createdAt: daysAgo(55),
      },
    ]);
  });

  afterAll(async () => {
    await Report.deleteMany({ caseId: ids.case });
    await HomeAssignment.deleteMany({ caseId: ids.case });
    await SessionLog.deleteMany({ caseId: ids.case });
    await TherapyPlan.deleteMany({ caseId: ids.case });
    await TherapyCase.deleteMany({ caseId: ids.case });
    await ChildCase.deleteMany({ _id: ids.case });
    await Submission.deleteMany({ childId: ids.child });
    await User.deleteMany({ email: { $in: Object.values(emails) } });
    await disconnectTestDb();
  });

  const SHARED = ['child', 'parentName', 'therapistName', 'caseRef', 'period', 'screening', 'stats', 'summary', 'domains', 'goals', 'trend', 'highlights', 'recommendations'];

  test('every report type carries the identical core', async () => {
    for (const type of ['parent', 'clinician', 'progress', 'monthly', 'iep', 'therapy', 'session']) {
      const res = await request(app).post('/api/reports/generate').set(authHeader(tokens.therapist)).send({ caseId: ids.case, type });
      expect(res.statusCode).toBe(201);
      reports[type] = { id: String(res.body.data.reportId), data: res.body.data.data };
    }
    const integrated = await request(app).post(`/api/reports/generate/${ids.case}`).set(authHeader(tokens.therapist));
    expect(integrated.statusCode).toBe(201);
    reports.integrated = { id: String(integrated.body.data.reportId), data: integrated.body.data.data };

    const base = reports.parent.data;
    expect(base.schema).toBe('standard-v1');
    for (const [type, r] of Object.entries(reports)) {
      expect(r.data.type).toBe(type);
      for (const key of SHARED) expect({ type, key, value: r.data[key] }).toEqual({ type, key, value: base[key] });
    }
  });

  test('the core figures are correct and use one unit', () => {
    const d = reports.parent.data;
    expect(d.child).toMatchObject({ name: 'Hamza Khan', gender: 'Male', ageMonths: 30 });
    expect(d.parentName).toBe('Ayesha Khan');
    expect(d.therapistName).toBe('Sara Therapist');

    const s = d.stats;
    expect(s.sessionsCompleted).toBe(4); // second therapist's 3 sessions excluded
    expect(s.sessionsMissed).toBe(1);
    expect(s.attendancePct).toBe(80);
    expect(s.assignmentsTotal).toBe(3);
    expect(s.assignmentsCompleted).toBe(2);
    expect(s.goalsTotal).toBe(2);
    expect(s.baselinePct).toBe(40); // baseline 2/5
    expect(s.improvementPts).toBeGreaterThan(0);
    expect(Number.isInteger(s.overallProgressPct)).toBe(true);
    expect(s.overallProgressPct).toBeGreaterThan(40);
    expect(s.overallProgressPct).toBeLessThanOrEqual(100);

    expect(d.goals.map((g) => g.name)).toEqual(['Two-word requests', 'Turn-taking in play']);
    for (const g of d.goals) {
      expect(g).toMatchObject({ baselinePct: 40, targetPct: 80 });
      expect(g.changePts).toBe(g.currentPct - g.baselinePct);
    }
    expect(d.domains.map((x) => x.label).sort()).toEqual(['Occupational therapy', 'Speech & language']);
    expect(d.goals.map((g) => g.domain)).toEqual(['Speech & language', 'Occupational therapy']);
    expect(d.trend.length).toBe(4);
    expect(d.trend.every((p) => Number.isInteger(p.pct))).toBe(true);

    expect(d.screening.mchat).toMatchObject({ totalScore: 9, riskLevel: 'high' });
    const zones = Object.fromEntries(d.screening.asq3.domains.map((x) => [x.domain, x.zone]));
    expect(zones).toEqual({ Communication: 'refer', 'Gross Motor': 'ok', 'Fine Motor': 'ok', 'Problem Solving': 'monitor', 'Personal-Social': 'ok' });
  });

  test('in-app progress for parent, clinician and therapist matches the report', async () => {
    const expected = reports.parent.data.stats.overallProgressPct;

    const parentView = await request(app).get(`/api/case/${ids.case}/progress`).set(authHeader(tokens.parent));
    expect(parentView.statusCode).toBe(200);
    expect(parentView.body.data.overallProgressPercent).toBe(expected);

    const clinicianView = await request(app).get(`/api/progress/${ids.case}/overview`).set(authHeader(tokens.clinician));
    expect(clinicianView.statusCode).toBe(200);
    expect(clinicianView.body.data.overallProgressPercent).toBe(expected);

    const caseload = await request(app).get('/api/clinician/caseload-progress').set(authHeader(tokens.clinician));
    const row = caseload.body.data.cases.find((x) => String(x.caseId) === ids.case);
    expect(Math.round((row.snapshot.overallScore / 5) * 100)).toBe(expected);

    const therapistView = await request(app).get(`/api/analytics/${ids.case}`).set(authHeader(tokens.therapist));
    expect(therapistView.statusCode).toBe(200);
    expect(therapistView.body.data.overallProgress).toBe(expected);
  });

  test('each role downloads a real, named PDF of the report it may see', async () => {
    const cases = [
      ['parent', reports.parent.id, 'parent'],
      ['clinician', reports.clinician.id, 'clinician'],
      ['clinician', reports.integrated.id, 'integrated'],
      ['therapist', reports.iep.id, 'iep'],
    ];
    for (const [role, reportId, type] of cases) {
      const res = await request(app)
        .get(`/api/reports/${reportId}/download`)
        .set(authHeader(tokens[role]))
        .buffer(true)
        .parse((r, cb) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['content-disposition']).toMatch(new RegExp(`AutismCare_${type}_Hamza_Khan_\\d{4}-\\d{2}-\\d{2}\\.pdf`));
      expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
      expect(res.body.length).toBeGreaterThan(5000);
      if (process.env.SAMPLE_PDF_DIR) fs.writeFileSync(path.join(process.env.SAMPLE_PDF_DIR, `${type}.pdf`), res.body);
      if (process.env.SAMPLE_PDF_DIR && type === 'parent') {
        fs.writeFileSync(path.join(process.env.SAMPLE_PDF_DIR, 'parent.json'), JSON.stringify(reports.parent.data));
      }
    }

    const forbidden = await request(app).get(`/api/reports/${reports.clinician.id}/download`).set(authHeader(tokens.parent));
    expect(forbidden.statusCode).toBe(403);
  });
});
