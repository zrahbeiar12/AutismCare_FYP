const { test, expect } = require('@playwright/test');
const path = require('path');

const serverRoot = path.resolve(__dirname, '../../../server');
require(path.resolve(serverRoot, 'src/config/database.js'));
const mongoose = require(path.resolve(serverRoot, 'node_modules/mongoose'));
const { User } = require(path.resolve(serverRoot, 'src/models/User.js'));
const LabTestRequest = require(path.resolve(serverRoot, 'src/models/LabTestRequest.js'));
const LabReport = require(path.resolve(serverRoot, 'src/models/LabReport.js'));
const { ChildCase } = require(path.resolve(serverRoot, 'src/models/ChildCase.js'));

const password = 'Password123!';
const API_BASE = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:4000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/asd_management';

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`;
}

async function seedUser(userData) {
  await User.deleteMany({ email: userData.email });
  return User.create(userData);
}

async function apiLogin(request, email) {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token;
}

async function uiLogin(page, email) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form').getByRole('button', { name: /^login$/i }).click();
  // Parent welcome wizard may overlay the dashboard and disable pointer events.
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    const skip = page.getByRole('button', { name: /skip tour|close|get started/i }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await expect(dialog).toBeHidden({ timeout: 15000 });
  }
}

test.describe.serial('Lab release flow (clinician -> parent)', () => {
  const parentEmail = uniqueEmail('e2e.parent.lab');
  const clinicianEmail = uniqueEmail('e2e.clinician.lab');
  let parentId = '';
  let clinicianId = '';
  let childId = '';
  let requestId = '';
  let caseId = '';

  test.beforeAll(async ({ request }) => {
    await mongoose.connect(MONGO_URI);

    const parent = await seedUser({
      firstName: 'E2E',
      lastName: 'Parent',
      email: parentEmail,
      password,
      role: 'parent',
      isEmailVerified: true,
      approvalStatus: 'active',
    });
    parentId = String(parent._id);

    const parentDoc = await User.findById(parentId);
    parentDoc.children.push({
      firstName: 'Lab',
      lastName: 'Child',
      dateOfBirth: new Date('2020-01-15'),
      gender: 'female',
      emergencyContact: 'E2E Parent',
      emergencyPhone: '03001234567',
    });
    await parentDoc.save({ validateModifiedOnly: true });
    childId = String(parentDoc.children[parentDoc.children.length - 1]._id);

    const clinician = await seedUser({
      firstName: 'E2E',
      lastName: 'Clinician',
      email: clinicianEmail,
      password,
      role: 'clinician',
      specialization: 'Pediatrics',
      licenseNumber: `CLIN-${Date.now()}`,
      approvalStatus: 'active',
      isEmailVerified: true,
    });
    clinicianId = String(clinician._id);

    // Lab requests are gated to a case in DIAGNOSIS by the case lifecycle (validateCaseState).
    const createdCase = await ChildCase.create({
      parentId,
      childId,
      clinicianId,
      status: 'DIAGNOSIS',
    });
    caseId = String(createdCase._id);

    // Create test request via clinician API
    const clinicianToken = await apiLogin(request, clinicianEmail);
    const createRes = await request.post(`${API_BASE}/api/lab/clinician/requests`, {
      headers: { Authorization: `Bearer ${clinicianToken}` },
      data: {
        caseId,
        parentId,
        childId,
        childName: 'Lab Child',
        childAge: 5,
        testType: 'Blood',
        notes: 'E2E lab request',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    requestId = String(createBody.data?._id || '');
    expect(requestId).toBeTruthy();

    // Seed an uploaded report + set status UPLOADED (simulating lab upload without multipart)
    await LabReport.create({
      testRequestId: requestId,
      childId,
      clinicianId,
      labTechnicianId: clinicianId, // not ideal, but sufficient for read paths
      fileUrl: '/uploads/lab-reports/e2e-report.pdf',
      fileType: 'application/pdf',
      fileName: 'e2e-report.pdf',
      fileSize: 1234,
    });
    await LabTestRequest.updateOne({ _id: requestId }, { $set: { status: 'UPLOADED' } });
  });

  test.afterAll(async () => {
    if (requestId) {
      await LabReport.deleteMany({ testRequestId: requestId });
      await LabTestRequest.deleteMany({ _id: requestId });
    }
    if (caseId) await ChildCase.deleteMany({ _id: caseId });
    await User.deleteMany({ email: { $in: [parentEmail, clinicianEmail] } });
    await mongoose.disconnect();
  });

  test('clinician releases and parent can see report', async ({ page, request }) => {
    // Clinician releases via API then verifies UI
    const clinicianToken = await apiLogin(request, clinicianEmail);
    const releaseRes = await request.patch(`${API_BASE}/api/lab/clinician/requests/${requestId}/release`, {
      headers: { Authorization: `Bearer ${clinicianToken}` },
    });
    expect(releaseRes.ok()).toBeTruthy();

    await uiLogin(page, parentEmail);
    await expect(page).toHaveURL(/\/parent-dashboard$/, { timeout: 30000 });

    const labNav = page
      .getByRole('button', { name: /lab reports/i })
      .or(page.getByRole('link', { name: /lab reports/i }))
      .or(page.getByText(/^lab reports$/i).locator('xpath=ancestor::*[self::button or self::a][1]'))
      .first();
    await expect(labNav).toBeVisible({ timeout: 15000 });
    await labNav.evaluate((el) => el.click());

    await expect(page.getByText(/no lab reports available yet/i).or(page.getByText(/lab reports/i))).toBeVisible();
    await expect(
      page
        .getByText(/reviewed\s*&\s*released/i)
        .or(page.getByText(/^blood$/i))
        .first()
    ).toBeVisible({ timeout: 15000 });
  });
});

