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
const Organization = require('../../src/models/Organization');
const Counter = require('../../src/models/Counter');
const {
  assignCaseFileNumber,
  backfillCaseFileNumbers,
  getDefaultOrganization,
  resetDefaultOrganizationCache,
} = require('../../src/services/caseFileNumberService');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser, authHeader } = require('../helpers/authHelpers');

describe('Sequential case file numbers and MR numbers', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const emails = {
    admin: `admin.fn.${suffix}@test.com`,
    clinician: `clin.fn.${suffix}@test.com`,
    clinician2: `clin2.fn.${suffix}@test.com`,
    parent: `parent.fn.${suffix}@test.com`,
  };
  const tok = {};
  const ids = {};
  const year = new Date().getFullYear();
  let org2;

  async function newCase(clinicianKey = 'clinician') {
    const childId = new mongoose.Types.ObjectId();
    const c = await ChildCase.create({ parentId: ids.parent, childId, clinicianId: ids[clinicianKey], status: 'REVIEW' });
    return c;
  }

  beforeAll(async () => {
    await connectTestDb();
    resetDefaultOrganizationCache();
    await new User({ firstName: 'Ad', lastName: 'Min', email: emails.admin, password, role: 'admin', isEmailVerified: true }).save();
    await registerUser(app, { firstName: 'C', lastName: 'One', email: emails.clinician, password, role: 'clinician', specialization: 'Pediatrics', licenseNumber: `FN1-${suffix}` });
    await registerUser(app, { firstName: 'C', lastName: 'Two', email: emails.clinician2, password, role: 'clinician', specialization: 'Pediatrics', licenseNumber: `FN2-${suffix}` });
    await registerUser(app, { firstName: 'P', lastName: 'Arent', email: emails.parent, password, role: 'parent' });
    for (const e of Object.values(emails)) await activateUser(e, { approvalStatus: 'active' });
    for (const [k, e] of Object.entries(emails)) {
      tok[k] = (await loginUser(app, e, password)).body.token;
      ids[k] = String((await User.findOne({ email: e }))._id);
    }
  });

  afterAll(async () => {
    await ChildCase.deleteMany({ parentId: ids.parent });
    if (org2) await Organization.deleteMany({ _id: org2._id });
    await Counter.deleteMany({ _id: new RegExp(`^caseFile:`) });
    await User.deleteMany({ email: { $in: Object.values(emails) } });
    await disconnectTestDb();
  });

  test('cases registered at the same moment get distinct, consecutive numbers with no gaps', async () => {
    const org = await getDefaultOrganization();
    const cases = await Promise.all([1, 2, 3, 4, 5].map(() => newCase()));
    const results = await Promise.all(cases.map((c) => assignCaseFileNumber(c._id, { clinicianId: ids.clinician })));
    const seqs = results.map((r) => r.fileSeq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(5);
    expect(seqs[4] - seqs[0]).toBe(4);
    for (const r of results) {
      expect(r.fileNumber).toBe(`${org.code}-${year}-${String(r.fileSeq).padStart(6, '0')}`);
      expect(String(r.organizationId)).toBe(String(org._id));
    }
    // Asking again never renumbers a case.
    const again = await assignCaseFileNumber(cases[0]._id, { clinicianId: ids.clinician });
    expect(again.fileNumber).toBe(results[0].fileNumber);
  });

  test('admin creates a second organisation; its staff number their cases from 1 with its own code', async () => {
    const created = await request(app)
      .post('/api/admin/organizations')
      .set(authHeader(tok.admin))
      .send({ name: "Children's Hospital Test", code: `T${String(suffix).slice(-5)}`, city: 'Lahore' });
    expect(created.statusCode).toBe(201);
    org2 = created.body.data;

    const dupe = await request(app).post('/api/admin/organizations').set(authHeader(tok.admin)).send({ name: 'Other', code: org2.code });
    expect(dupe.statusCode).toBe(409);

    const assign = await request(app)
      .put(`/api/admin/users/${ids.clinician2}/organization`)
      .set(authHeader(tok.admin))
      .send({ organizationId: org2._id });
    expect(assign.statusCode).toBe(200);

    const c = await newCase('clinician2');
    const numbered = await assignCaseFileNumber(c._id, { clinicianId: ids.clinician2 });
    expect(numbered.fileNumber).toBe(`${org2.code}-${year}-000001`);

    const list = await request(app).get('/api/admin/organizations').set(authHeader(tok.admin));
    expect(list.body.data.some((o) => o.code === org2.code && o.staffCount === 1)).toBe(true);
  });

  test('backfill numbers older cases in the order they were created', async () => {
    const older = await ChildCase.create({ parentId: ids.parent, childId: new mongoose.Types.ObjectId(), clinicianId: ids.clinician, createdAt: new Date('2025-01-01') });
    const newer = await ChildCase.create({ parentId: ids.parent, childId: new mongoose.Types.ObjectId(), clinicianId: ids.clinician, createdAt: new Date('2025-06-01') });
    await backfillCaseFileNumbers();
    const [o, n] = await Promise.all([ChildCase.findById(older._id).lean(), ChildCase.findById(newer._id).lean()]);
    expect(o.fileSeq).toBe(n.fileSeq - 1);
  });

  test('MR numbers are unique within an organisation and editable by the case clinician', async () => {
    const [a, b] = await Promise.all([newCase(), newCase()]);
    const setA = await request(app).patch(`/api/cases/${a._id}/mr-number`).set(authHeader(tok.clinician)).send({ mrNumber: 'MR-1001' });
    expect(setA.statusCode).toBe(200);
    expect(setA.body.data.mrNumber).toBe('MR-1001');
    expect(setA.body.data.fileNumber).toMatch(/-\d{4}-\d{6}$/);

    const clash = await request(app).patch(`/api/cases/${b._id}/mr-number`).set(authHeader(tok.clinician)).send({ mrNumber: 'MR-1001' });
    expect(clash.statusCode).toBe(409);

    const bad = await request(app).patch(`/api/cases/${b._id}/mr-number`).set(authHeader(tok.clinician)).send({ mrNumber: '<script>' });
    expect(bad.statusCode).toBe(400);

    const notMine = await request(app).patch(`/api/cases/${a._id}/mr-number`).set(authHeader(tok.clinician2)).send({ mrNumber: 'X1' });
    expect(notMine.statusCode).toBe(404);

    // Same MR number is fine in a different organisation.
    const c2 = await newCase('clinician2');
    const other = await request(app).patch(`/api/cases/${c2._id}/mr-number`).set(authHeader(tok.clinician2)).send({ mrNumber: 'MR-1001' });
    expect(other.statusCode).toBe(200);

    const list = await request(app).get('/api/cases').set(authHeader(tok.clinician));
    const row = list.body.data.find((r) => String(r._id) === String(a._id));
    expect(row).toMatchObject({ mrNumber: 'MR-1001' });
    expect(row.fileNumber).toBeTruthy();
  });
});
