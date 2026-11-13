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
const { HomeAssignment } = require('../../src/models/HomeAssignment');
const LabReport = require('../../src/models/LabReport');
const LabTestRequest = require('../../src/models/LabTestRequest');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser, authHeader } = require('../helpers/authHelpers');

/** Uploaded files are patient data: only signed-in users who may see the owning record can download them. */
describe('Uploaded files are not public', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const emails = {
    parent: `parent.upl.${suffix}@test.com`,
    otherParent: `other.upl.${suffix}@test.com`,
    clinician: `clinician.upl.${suffix}@test.com`,
    therapist: `therapist.upl.${suffix}@test.com`,
  };
  const tok = {};
  const ids = {};
  const files = {
    evidence: `/uploads/home-assignments/test-evidence-${suffix}.png`,
    lab: `/uploads/lab-reports/test-lab-${suffix}.pdf`,
    report: `/uploads/reports/test-report-${suffix}.pdf`,
  };
  const abs = (u) => path.join(process.cwd(), u.replace(/^\//, ''));

  beforeAll(async () => {
    await connectTestDb();
    await registerUser(app, { firstName: 'P', lastName: 'One', email: emails.parent, password, role: 'parent' });
    await registerUser(app, { firstName: 'P', lastName: 'Two', email: emails.otherParent, password, role: 'parent' });
    await registerUser(app, { firstName: 'C', lastName: 'Lin', email: emails.clinician, password, role: 'clinician', specialization: 'Pediatrics', licenseNumber: `U-C-${suffix}` });
    await registerUser(app, { firstName: 'T', lastName: 'Her', email: emails.therapist, password, role: 'therapist', specialization: 'Speech Therapist', licenseNumber: `U-T-${suffix}` });
    for (const e of Object.values(emails)) await activateUser(e, { approvalStatus: 'active' });
    for (const [k, e] of Object.entries(emails)) {
      tok[k] = (await loginUser(app, e, password)).body.token;
      ids[k] = String((await User.findOne({ email: e }))._id);
    }
    const parent = await User.findOne({ email: emails.parent });
    parent.children.push({ firstName: 'Kid', lastName: 'One', dateOfBirth: new Date('2024-01-01'), gender: 'male', emergencyContact: 'P', emergencyPhone: '03001234567' });
    await parent.save({ validateModifiedOnly: true });
    ids.child = String(parent.children[parent.children.length - 1]._id);

    const c = await ChildCase.create({ parentId: ids.parent, childId: ids.child, clinicianId: ids.clinician, therapistId: ids.therapist, status: 'THERAPY_ACTIVE' });
    ids.case = String(c._id);
    await TherapyCase.create({ caseId: ids.case, therapistId: ids.therapist, referralId: new mongoose.Types.ObjectId(), status: 'ACTIVE', startedAt: new Date() });
    await HomeAssignment.create({ caseId: ids.case, therapistId: ids.therapist, title: 'Evidence', instructions: 'x', dueDate: new Date(), status: 'submitted', parentSubmission: { fileUrl: files.evidence, fileType: 'image' } });

    const req = await LabTestRequest.create({
      childId: ids.child, childName: 'Kid One', childAge: 2, parentId: ids.parent, clinicianId: ids.clinician, caseId: ids.case,
      requestPurpose: 'ASD_DIAGNOSTIC_WORKUP', priority: 'ROUTINE', requestedItems: [], status: 'UPLOADED', releasedToParent: false,
    });
    ids.labRequest = req ? String(req._id) : null;
    if (req) {
      await LabReport.create({ testRequestId: req._id, childId: ids.child, clinicianId: ids.clinician, labTechnicianId: ids.clinician, fileUrl: files.lab, fileType: 'application/pdf', fileName: 'lab.pdf', fileSize: 10 });
    }

    for (const u of Object.values(files)) {
      fs.mkdirSync(path.dirname(abs(u)), { recursive: true });
      fs.writeFileSync(abs(u), 'test file');
    }
  });

  afterAll(async () => {
    for (const u of Object.values(files)) fs.rmSync(abs(u), { force: true });
    await LabReport.deleteMany({ childId: ids.child });
    await LabTestRequest.deleteMany({ childId: ids.child });
    await HomeAssignment.deleteMany({ caseId: ids.case });
    await TherapyCase.deleteMany({ caseId: ids.case });
    await ChildCase.deleteMany({ _id: ids.case });
    await User.deleteMany({ email: { $in: Object.values(emails) } });
    await disconnectTestDb();
  });

  const get = (u, who) => {
    const r = request(app).get(u);
    return who ? r.set(authHeader(tok[who])) : r;
  };

  test('no login → 401', async () => {
    expect((await get(files.evidence)).statusCode).toBe(401);
  });

  test('home-practice evidence: owning parent, clinician and therapist yes; other family no', async () => {
    expect((await get(files.evidence, 'parent')).statusCode).toBe(200);
    expect((await get(files.evidence, 'clinician')).statusCode).toBe(200);
    expect((await get(files.evidence, 'therapist')).statusCode).toBe(200);
    expect((await get(files.evidence, 'otherParent')).statusCode).toBe(403);
  });

  test('lab report is hidden from the parent until released', async () => {
    expect((await get(files.lab, 'clinician')).statusCode).toBe(200);
    expect((await get(files.lab, 'parent')).statusCode).toBe(403);
    await LabTestRequest.updateOne({ _id: ids.labRequest }, { $set: { releasedToParent: true } });
    expect((await get(files.lab, 'parent')).statusCode).toBe(200);
    expect((await get(files.lab, 'otherParent')).statusCode).toBe(403);
  });

  test('generated report PDFs are not reachable directly, and path tricks are refused', async () => {
    expect((await get(files.report, 'parent')).statusCode).toBe(403);
    expect([400, 403, 404]).toContain((await get('/uploads/home-assignments/../reports/x.pdf', 'parent')).statusCode);
    expect((await get('/uploads/home-assignments/not-a-real-file.png', 'parent')).statusCode).toBe(403);
  });
});
