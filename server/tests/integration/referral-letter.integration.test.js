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
const { Referral } = require('../../src/models/Referral');
const { ClinicalEvaluation } = require('../../src/models/ClinicalEvaluation');
const { assignCaseFileNumber } = require('../../src/services/caseFileNumberService');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser, authHeader } = require('../helpers/authHelpers');

describe('Printable referral letter', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const emails = {
    clinician: `clin.letter.${suffix}@test.com`,
    other: `clin2.letter.${suffix}@test.com`,
    parent: `parent.letter.${suffix}@test.com`,
  };
  const tok = {};
  const ids = {};

  const pdf = (r) =>
    r.buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  beforeAll(async () => {
    await connectTestDb();
    await registerUser(app, { firstName: 'Ali', lastName: 'Raza', email: emails.clinician, password, role: 'clinician', specialization: 'Developmental Paediatrics', licenseNumber: `PMC-L-${suffix}` });
    await registerUser(app, { firstName: 'X', lastName: 'Y', email: emails.other, password, role: 'clinician', specialization: 'Pediatrics', licenseNumber: `PMC-L2-${suffix}` });
    await registerUser(app, { firstName: 'Ayesha', lastName: 'Khan', email: emails.parent, password, role: 'parent' });
    for (const e of Object.values(emails)) await activateUser(e, { approvalStatus: 'active' });
    for (const [k, e] of Object.entries(emails)) {
      tok[k] = (await loginUser(app, e, password)).body.token;
      ids[k] = String((await User.findOne({ email: e }))._id);
    }
    const parent = await User.findOne({ email: emails.parent });
    parent.children.push({ firstName: 'Hamza', lastName: 'Khan', dateOfBirth: new Date('2024-05-13'), gender: 'male', emergencyContact: 'A', emergencyPhone: '03001234567' });
    await parent.save({ validateModifiedOnly: true });
    const childId = parent.children[parent.children.length - 1]._id;
    const c = await ChildCase.create({ parentId: ids.parent, childId, clinicianId: ids.clinician, status: 'DIAGNOSIS_READY', mrNumber: 'MR-777' });
    ids.case = String(c._id);
    await assignCaseFileNumber(c._id, { clinicianId: ids.clinician });
    await ClinicalEvaluation.create({
      caseId: c._id,
      clinicianId: ids.clinician,
      status: 'FINALIZED',
      diagnosis: { primary: 'Autism spectrum disorder', severityLevel: 'Level 1', confidence: 'high', rationale: 'DSM-5 criteria met' },
      recommendations: { therapies: ['Speech therapy weekly'], followUp: 'Review in 3 months' },
    });
    const r = await Referral.create({ caseId: c._id, clinicianId: ids.clinician, therapistType: 'Speech Therapist', priority: 'high', notes: 'Limited expressive language' });
    ids.referral = String(r._id);
  });

  afterAll(async () => {
    await Referral.deleteMany({ caseId: ids.case });
    await ClinicalEvaluation.deleteMany({ caseId: ids.case });
    await ChildCase.deleteMany({ _id: ids.case });
    await User.deleteMany({ email: { $in: Object.values(emails) } });
    await disconnectTestDb();
  });

  test('referring clinician downloads a PDF named after the child and file number', async () => {
    const res = await pdf(request(app).get(`/api/referrals/${ids.referral}/letter`).set(authHeader(tok.clinician)));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    const fileNumber = (await ChildCase.findById(ids.case).lean()).fileNumber;
    expect(res.headers['content-disposition']).toContain(`Referral_Hamza_Khan_${fileNumber}.pdf`);
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(1500);
    if (process.env.SAMPLE_PDF_DIR) fs.writeFileSync(path.join(process.env.SAMPLE_PDF_DIR, 'referral.pdf'), res.body);
  });

  test('other clinicians and parents cannot get it', async () => {
    expect((await request(app).get(`/api/referrals/${ids.referral}/letter`).set(authHeader(tok.other))).statusCode).toBe(403);
    expect((await request(app).get(`/api/referrals/${ids.referral}/letter`).set(authHeader(tok.parent))).statusCode).toBe(403);
    expect((await request(app).get(`/api/referrals/${new mongoose.Types.ObjectId()}/letter`).set(authHeader(tok.clinician))).statusCode).toBe(404);
  });
});
