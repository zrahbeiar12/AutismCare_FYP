const { test, expect } = require('@playwright/test');
const path = require('path');

const serverRoot = path.resolve(__dirname, '../../../server');
require(path.resolve(serverRoot, 'src/config/database.js'));
const mongoose = require(path.resolve(serverRoot, 'node_modules/mongoose'));
const { User } = require(path.resolve(serverRoot, 'src/models/User.js'));
const { ChildCase } = require(path.resolve(serverRoot, 'src/models/ChildCase.js'));
const TherapyCase = require(path.resolve(serverRoot, 'src/models/TherapyCase.js'));
const { HomeAssignment } = require(path.resolve(serverRoot, 'src/models/HomeAssignment.js'));

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

test.describe.serial('Home assignment loop (parent submit -> therapist review -> parent complete)', () => {
  const parentEmail = uniqueEmail('e2e.parent.assign');
  const clinicianEmail = uniqueEmail('e2e.clinician.assign');
  const therapistEmail = uniqueEmail('e2e.therapist.assign');
  let parentId = '';
  let clinicianId = '';
  let therapistId = '';
  let childId = '';
  let caseId = '';
  let assignmentId = '';

  test.beforeAll(async ({ request }) => {
    await mongoose.connect(MONGO_URI);

    const parent = await seedUser({
      firstName: 'E2E',
      lastName: 'Parent',
      email: parentEmail,
      password,
      role: 'parent',
      isEmailVerified: true,
    });
    parentId = String(parent._id);

    const parentDoc = await User.findById(parentId);
    parentDoc.children.push({
      firstName: 'Assign',
      lastName: 'Child',
      dateOfBirth: new Date('2021-01-01'),
      gender: 'male',
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

    const therapist = await seedUser({
      firstName: 'E2E',
      lastName: 'Therapist',
      email: therapistEmail,
      password,
      role: 'therapist',
      specialization: 'Speech Therapy',
      licenseNumber: `THER-${Date.now()}`,
      approvalStatus: 'active',
      isEmailVerified: true,
    });
    therapistId = String(therapist._id);

    // Create a ChildCase directly
    const createdCase = await ChildCase.create({
      parentId,
      childId,
      clinicianId,
      // Assignment routes are gated to THERAPY_ACTIVE by the case lifecycle (validateCaseState).
      status: 'THERAPY_ACTIVE',
    });
    caseId = String(createdCase._id);

    // Create an ACTIVE therapy case so parent messaging/assignment flows are unlocked
    await TherapyCase.create({
      caseId,
      parentId,
      childId,
      therapistId,
      status: 'ACTIVE',
    });

    // Therapist creates assignment via API
    const therapistToken = await apiLogin(request, therapistEmail);
    const due = new Date();
    due.setDate(due.getDate() + 3);
    const createRes = await request.post(`${API_BASE}/api/assignments`, {
      headers: { Authorization: `Bearer ${therapistToken}` },
      data: {
        caseId,
        title: `E2E Assignment ${Date.now()}`,
        instructions: 'Do the activity and submit evidence.',
        dueDate: due.toISOString(),
        materials: 'None',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    assignmentId = String(createBody.data?._id || createBody.data?.id || '');
    expect(assignmentId).toBeTruthy();
    assignmentId && (assignmentId = assignmentId);
  });

  test.afterAll(async () => {
    if (assignmentId) await HomeAssignment.deleteMany({ _id: assignmentId });
    if (caseId) {
      await TherapyCase.deleteMany({ caseId });
      await ChildCase.deleteMany({ _id: caseId });
    }
    await User.deleteMany({ email: { $in: [parentEmail, clinicianEmail, therapistEmail] } });
    await mongoose.disconnect();
  });

  test('parent sees assignment in case panel', async ({ page }) => {
    await uiLogin(page, parentEmail);
    await expect(page).toHaveURL(/\/parent-dashboard$/, { timeout: 30000 });

    const childCaseNav = page
      .getByRole('button', { name: /child case/i })
      .or(page.getByRole('link', { name: /child case/i }))
      .or(page.getByText(/^child case$/i).locator('xpath=ancestor::*[self::button or self::a][1]'))
      .first();
    await expect(childCaseNav).toBeVisible({ timeout: 15000 });
    await childCaseNav.evaluate((el) => el.click());

    // We render assignment name somewhere in the Home assignments card
    await expect(page.getByRole('heading', { name: /home assignments/i })).toBeVisible();
    await expect(page.getByText(/e2e assignment/i)).toBeVisible({ timeout: 15000 });
  });

  test('parent submits evidence URL via API, therapist reviews, parent completes', async ({ page, request }) => {
    // Parent token from UI session
    await uiLogin(page, parentEmail);
    await expect(page).toHaveURL(/\/parent-dashboard$/, { timeout: 30000 });
    const parentToken = await page.evaluate(() => sessionStorage.getItem('token') || localStorage.getItem('token'));
    expect(parentToken).toBeTruthy();

    // Parent submits evidence (URL method, safe uploads path required)
    const submitRes = await request.patch(`${API_BASE}/api/parent/assignments/${assignmentId}/submit`, {
      headers: { Authorization: `Bearer ${parentToken}` },
      data: { submissionUrl: '/uploads/home-assignments/e2e-proof.pdf', fileType: 'image' },
    });
    expect(submitRes.ok()).toBeTruthy();

    // Therapist reviews
    const therapistToken = await apiLogin(request, therapistEmail);
    const reviewRes = await request.patch(`${API_BASE}/api/assignments/${assignmentId}/review`, {
      headers: { Authorization: `Bearer ${therapistToken}` },
      data: { rating: 4, comment: 'Nice work. Keep it up.' },
    });
    expect(reviewRes.ok()).toBeTruthy();

    // Parent completes
    const completeRes = await request.patch(`${API_BASE}/api/parent/assignments/${assignmentId}/complete`, {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    expect(completeRes.ok()).toBeTruthy();

    // UI check: parent case panel shows Completed badge (case-insensitive)
    const childCaseNav = page
      .getByRole('button', { name: /child case/i })
      .or(page.getByRole('link', { name: /child case/i }))
      .or(page.getByText(/^child case$/i).locator('xpath=ancestor::*[self::button or self::a][1]'))
      .first();
    await childCaseNav.evaluate((el) => el.click());
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 15000 });
  });
});

