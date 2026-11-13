const { test, expect } = require('@playwright/test');
const path = require('path');

const serverRoot = path.resolve(__dirname, '../../../server');

require(path.resolve(serverRoot, 'src/config/database.js'));

const mongoose = require(path.resolve(serverRoot, 'node_modules/mongoose'));
const { User } = require(path.resolve(serverRoot, 'src/models/User.js'));
const { ChildCase } = require(path.resolve(serverRoot, 'src/models/ChildCase.js'));
const { Appointment } = require(path.resolve(serverRoot, 'src/models/Appointment.js'));
const { Referral } = require(path.resolve(serverRoot, 'src/models/Referral.js'));
const { ClinicalEvaluation } = require(path.resolve(serverRoot, 'src/models/ClinicalEvaluation.js'));
const TherapyCase = require(path.resolve(serverRoot, 'src/models/TherapyCase.js'));

const password = 'Password123!';

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`;
}

async function seedUser(userData) {
  await User.deleteMany({ email: userData.email });
  return User.create(userData);
}

test.describe.serial('Browser authentication workflows', () => {
  const parentEmail = uniqueEmail('e2e.parent');
  const clinicianEmail = uniqueEmail('e2e.clinician');
  const therapistEmail = uniqueEmail('e2e.therapist');
  let parentId;
  let childId;
  let clinicianId;
  let clinicianToken;
  let caseId;

  test.beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);

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
      firstName: 'Case',
      lastName: 'Child',
      dateOfBirth: new Date('2020-01-15'),
      gender: 'male',
      emergencyContact: 'E2E Parent',
      emergencyPhone: '03001234567',
    });
    await parentDoc.save({ validateModifiedOnly: true });
    childId = String(parentDoc.children[parentDoc.children.length - 1]._id);

    await seedUser({
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

    const clinicianDoc = await User.findOne({ email: clinicianEmail }).lean();
    clinicianId = String(clinicianDoc._id);

    await seedUser({
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

    const clinicianLogin = await fetch('http://127.0.0.1:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clinicianEmail, password }),
    });
    const clinicianLoginBody = await clinicianLogin.json();
    clinicianToken = clinicianLoginBody.token;

    const createdCaseResponse = await fetch('http://127.0.0.1:4000/api/cases/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clinicianToken}`,
      },
      body: JSON.stringify({ parentId, childId }),
    });
    const createdCaseBody = await createdCaseResponse.json();
    caseId = String(createdCaseBody.data?._id || createdCaseBody.data?.id || '');

    // Legacy /api/cases/create opens the case in NEW. Clinicians only see/evaluate cases from REVIEW
    // onwards (case lifecycle), which a submitted screening normally produces; simulate that state.
    if (caseId) {
      await ChildCase.updateOne({ _id: caseId }, { $set: { status: 'REVIEW' } });
    }
  });

  test.afterAll(async () => {
    if (caseId) {
      await ChildCase.deleteMany({ _id: caseId });
    }
    if (clinicianId) {
      await Appointment.deleteMany({ professional: clinicianId });
    }
    await User.deleteMany({ email: { $in: [parentEmail, clinicianEmail, therapistEmail] } });
    await mongoose.disconnect();
  });

  test('redirects anonymous users to login', async ({ page }) => {
    await page.goto('/parent-dashboard');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });

  test('logs in a parent, opens children section, and logs out', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(parentEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('checkbox', { name: /remember me/i }).check();
    await page.locator('form').getByRole('button', { name: /^login$/i }).click();

    await expect(page).toHaveURL(/\/parent-dashboard$/);
    // Parent welcome wizard may overlay the dashboard on first login.
    const dialog = page.getByRole('dialog');
    const dismiss = page.getByRole('button', { name: /skip tour|close|get started|next/i }).first();
    if (await dialog.isVisible().catch(() => false)) {
      if (await dismiss.isVisible().catch(() => false)) {
        await dismiss.click();
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      await expect(dialog).toBeHidden({ timeout: 15000 });
    }

    // Navigation items may render as buttons (section switch) or links (router).
    // Fall back to text lookup and click the nearest interactive ancestor.
    const childrenNav = page
      .getByRole('button', { name: /my children/i })
      .or(page.getByRole('link', { name: /my children/i }))
      .or(page.getByText(/^my children$/i).locator('xpath=ancestor::*[self::button or self::a][1]'))
      .first();
    await expect(childrenNav).toBeVisible({ timeout: 15000 });

    await childrenNav.evaluate((el) => el.click());
    const myChildrenHeading = page.getByRole('heading', { name: /my children/i });
    if (!(await myChildrenHeading.isVisible().catch(() => false))) {
      await childrenNav.evaluate((el) => el.click());
    }
    await expect(myChildrenHeading).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('form').getByRole('button', { name: /^login$/i })).toBeVisible();
  });

  test('creates a child and opens the child profile', async ({ page, request }) => {
    const childFirstName = `Child${Date.now().toString().slice(-4)}`;
    const childLastName = 'E2E';
    let childId;

    try {
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(parentEmail);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('form').getByRole('button', { name: /^login$/i }).click();

      await expect(page).toHaveURL(/\/parent-dashboard$/);

      // Parent welcome wizard may overlay the dashboard on first login.
      const dismiss = page.getByRole('button', { name: /skip|close|got it|continue/i }).first();
      if (await dismiss.isVisible().catch(() => false)) {
        await dismiss.click();
      }

      const childrenNav = page
        .getByRole('button', { name: /my children/i })
        .or(page.getByRole('link', { name: /my children/i }))
        .or(page.getByText(/^my children$/i).locator('xpath=ancestor::*[self::button or self::a][1]'))
        .first();
      await expect(childrenNav).toBeVisible({ timeout: 15000 });
      await childrenNav.evaluate((el) => el.click());
      const myChildrenHeading = page.getByRole('heading', { name: /my children/i });
      const addChildButton = page.getByRole('button', { name: /add child/i });
      // Retry once for flaky sidebar interaction on slower renders.
      if (!(await myChildrenHeading.isVisible().catch(() => false))) {
        await childrenNav.evaluate((el) => el.click());
      }
      await expect(myChildrenHeading.or(addChildButton).first()).toBeVisible({ timeout: 15000 });

      await page.getByRole('button', { name: /add child/i }).click();
      await expect(page.getByRole('heading', { name: /add new child profile/i })).toBeVisible();

      await page.locator('#firstName').fill(childFirstName);
      await page.locator('#lastName').fill(childLastName);
      await page.locator('#dateOfBirth').fill('2020-01-15');
      await page.getByRole('radio', { name: /^male$/i }).check();
      await page.locator('#emergencyContact').fill('E2E Parent');
      await page.locator('#emergencyPhone').fill('03001234567');
      await page.getByRole('button', { name: /create profile/i }).click();

      await expect(page.getByRole('heading', { name: /my children/i })).toBeVisible();
      await expect(page.getByText(new RegExp(`${childFirstName} ${childLastName}`, 'i'))).toBeVisible();

      const token = await page.evaluate(() => sessionStorage.getItem('token'));
      const childListResponse = await request.get('http://127.0.0.1:4000/api/child', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const childList = await childListResponse.json();
      const createdChild = (childList.data || []).find((child) => child.firstName === childFirstName && child.lastName === childLastName);
      childId = createdChild && String(createdChild.id || createdChild._id);

      await page.getByRole('button', { name: /view profile/i }).last().click();
      await expect(page.getByRole('heading', { name: new RegExp(`${childFirstName} ${childLastName}`, 'i') })).toBeVisible();
      await expect(page.getByText(/emergency contact/i)).toBeVisible();
    } finally {
      if (childId) {
        const token = await page.evaluate(() => sessionStorage.getItem('token'));
        await request.delete(`http://127.0.0.1:4000/api/child/${childId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
  });

  test('logs in a clinician and opens the seeded case', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(clinicianEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form').getByRole('button', { name: /^login$/i }).click();

    await expect(page).toHaveURL(/\/clinician-dashboard$/);
    // Clinician home is the "Clinical overview" section (ClinicalOverview, redesigned in fa2eb6e).
    await expect(page.locator('h2', { hasText: /clinical overview/i })).toBeVisible();

    // The case list is "Case directory" inside the collapsed "Workflows" sidebar group.
    const sidebar = page.getByRole('complementary');
    await sidebar.getByRole('button', { name: /^workflows$/i }).click();
    await sidebar.getByRole('button', { name: /^case directory$/i }).click();
    await expect(page.getByRole('heading', { name: /child cases/i })).toBeVisible();
    await expect(page.getByText(/case child/i)).toBeVisible();
    await expect(page.getByText(parentEmail)).toBeVisible();

    await page.getByRole('button', { name: /^open$/i }).click();
    await expect(page.getByRole('heading', { name: /case child/i })).toBeVisible();
    await expect(page.getByText(/parent \/ guardian/i)).toBeVisible();
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
  });

  test('approves a diagnostic appointment and creates a clinician case', async ({ page, request }) => {
    const appointmentDate = new Date();
    appointmentDate.setDate(appointmentDate.getDate() + 2);
    const preferredDate = appointmentDate.toISOString().slice(0, 10);
    const preferredTime = '10:30';
    const childFirstName = `Appt${Date.now().toString().slice(-4)}`;
    const childLastName = 'Flow';

    let createdChildId = '';
    let createdAppointmentId = '';
    let createdCaseId = '';

    try {
      const parentLogin = await request.post('http://127.0.0.1:4000/api/auth/login', {
        data: { email: parentEmail, password },
      });
      const parentLoginBody = await parentLogin.json();
      const parentToken = parentLoginBody.token;

      const childResponse = await request.post('http://127.0.0.1:4000/api/child', {
        headers: { Authorization: `Bearer ${parentToken}` },
        data: {
          firstName: childFirstName,
          lastName: childLastName,
          dateOfBirth: '2020-01-15',
          gender: 'male',
          emergencyContact: 'E2E Parent',
          emergencyPhone: '03001234567',
        },
      });
      const childBody = await childResponse.json();
      createdChildId = String(childBody.data?.id || childBody.data?._id || '');

      // Creating the child opens its case in NEW. Booking is gated to REVIEW (screening submitted)
      // and requires the caseId; simulate the submitted screening.
      const childCase = await ChildCase.findOneAndUpdate(
        { parentId, childId: createdChildId },
        { $set: { status: 'REVIEW' } },
        { new: true }
      );
      createdCaseId = String(childCase?._id || '');

      const appointmentResponse = await request.post('http://127.0.0.1:4000/api/appointments', {
        headers: { Authorization: `Bearer ${parentToken}` },
        multipart: {
          caseId: createdCaseId,
          childId: createdChildId,
          appointmentType: 'DIAGNOSTIC',
          professionalId: clinicianId,
          preferredDate,
          preferredTime,
          reason: 'Initial diagnostic assessment needed',
          mode: 'ONLINE',
          additionalNotes: 'Created by e2e test',
        },
      });
      const appointmentBody = await appointmentResponse.json();
      createdAppointmentId = String(appointmentBody.data?._id || '');

      await page.goto('/login');
      await page.locator('input[type="email"]').fill(clinicianEmail);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('form').getByRole('button', { name: /^login$/i }).click();

      await expect(page).toHaveURL(/\/clinician-dashboard$/);
      // Appointments is inside the collapsed "Operations" sidebar group.
      const sidebar = page.getByRole('complementary');
      await sidebar.getByRole('button', { name: /^operations$/i }).click();
      await sidebar.getByRole('button', { name: /^appointments$/i }).click();

      await expect(page.getByRole('heading', { name: /appointments management/i })).toBeVisible();
      await expect(page.getByText(new RegExp(`${childFirstName} ${childLastName}`, 'i'))).toBeVisible();

      await page.getByRole('button', { name: /^approve$/i }).click();
      await expect(page.getByRole('heading', { name: /approve appointment/i })).toBeVisible();
      await page.getByRole('button', { name: /confirm approve/i }).click();

      await expect(page.locator('span[data-slot="badge"]').filter({ hasText: 'Approved' })).toBeVisible();

      await sidebar.getByRole('button', { name: /^workflows$/i }).click();
      await sidebar.getByRole('button', { name: /^case directory$/i }).click();
      await expect(page.getByRole('heading', { name: /child cases/i })).toBeVisible();
      await expect(page.getByText(new RegExp(`${childFirstName} ${childLastName}`, 'i'))).toBeVisible();
    } finally {
      if (createdAppointmentId) {
        await Appointment.deleteMany({ _id: createdAppointmentId });
      }
      if (createdChildId) {
        await User.updateOne(
          { _id: parentId },
          { $pull: { children: { _id: createdChildId } } }
        );
      }
      if (createdCaseId) {
        await ChildCase.deleteMany({ _id: createdCaseId });
      }
    }
  });

  test('creates referral as clinician then therapist accepts and starts therapy', async ({ page, request }) => {
    const referralNote = `E2E referral ${Date.now()}`;
    let createdReferralId = '';
    let createdEvaluationId = '';

    try {
      const evaluationResponse = await request.post('http://127.0.0.1:4000/api/evaluations', {
        headers: { Authorization: `Bearer ${clinicianToken}` },
        data: {
          caseId,
          observations: 'E2E final evaluation observations',
          diagnosis: 'ASD indicators requiring therapy referral',
          recommendations: 'Start speech therapy pathway',
          status: 'final',
          // Finalizing requires a disposition; REFER_THERAPY moves the case to DIAGNOSIS_READY,
          // which is what allows the referral below.
          finalDisposition: 'REFER_THERAPY',
        },
      });
      expect(evaluationResponse.ok()).toBeTruthy();
      const evaluationBody = await evaluationResponse.json();
      createdEvaluationId = String(evaluationBody.data?._id || '');

      const referralResponse = await request.post('http://127.0.0.1:4000/api/referrals', {
        headers: { Authorization: `Bearer ${clinicianToken}` },
        data: {
          caseId,
          therapistType: 'Speech Therapist',
          priority: 'medium',
          notes: referralNote,
        },
      });
      expect(referralResponse.ok()).toBeTruthy();
      const referralBody = await referralResponse.json();
      createdReferralId = String(referralBody.data?._id || '');

      await page.goto('/login');

      await page.locator('input[type="email"]').fill(therapistEmail);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('form').getByRole('button', { name: /^login$/i }).click();

      await expect(page).toHaveURL(/\/therapist-dashboard$/);
      await page.getByRole('button', { name: /^assigned cases$/i }).click();

      await expect(page.getByRole('heading', { name: /assigned cases/i })).toBeVisible();
      await expect(page.getByText(/case child/i)).toBeVisible();

      await page.getByRole('button', { name: /^accept$/i }).first().click();
      await expect(page.getByText(/accepted/i)).toBeVisible();

      await page.getByRole('button', { name: /^start therapy$/i }).first().click();
      await expect(page).toHaveURL(/\/therapist\/case\//);

      // Therapy case file should render and the Therapy Plans tab should load.
      await expect(page.getByRole('heading', { name: /child therapy case file/i })).toBeVisible();
      await page.getByRole('tab', { name: /therapy plans/i }).click();

      // Assert new, refactored plan UI elements exist.
      // Card title heading (the builder's help text also contains a bold "Therapy plan").
      await expect(page.getByRole('heading', { name: /^therapy plan$/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /^save draft$/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /submit plan|submit therapy plan/i })).toBeVisible();

      // Domain selection uses pill buttons (not checkboxes).
      await expect(page.getByRole('button', { name: /^speech$/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /^ot$/i })).toBeVisible();

      // Backend/UI consistency smoke: therapist recommendation endpoint should work for active therapy cases.
      const therapistToken =
        await page.evaluate(() => sessionStorage.getItem('token') || localStorage.getItem('token'));
      expect(therapistToken).toBeTruthy();

      const recRes = await request.post('http://127.0.0.1:4000/api/therapist/recommendations', {
        headers: { Authorization: `Bearer ${therapistToken}` },
        data: {
          childId,
          therapyType: 'Speech Therapy',
          frequency: '2x per week',
          duration: '12 weeks',
          recommendation: 'Focus on two-word requests and receptive vocabulary during daily routines.',
        },
      });
      expect(recRes.ok()).toBeTruthy();
      const recBody = await recRes.json();
      expect(recBody.success).toBeTruthy();
    } finally {
      if (createdEvaluationId) {
        await ClinicalEvaluation.deleteMany({ _id: createdEvaluationId });
      }
      if (createdReferralId) {
        await TherapyCase.deleteMany({ referralId: createdReferralId });
        await Referral.deleteMany({ _id: createdReferralId });
      }
    }
  });

  test('blocks parent users from therapist routes', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(parentEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form').getByRole('button', { name: /^login$/i }).click();

    await expect(page).toHaveURL(/\/parent-dashboard$/);

    await page.goto('/therapist-dashboard');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });

  test('logs in a therapist and lands on the therapist dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(therapistEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form').getByRole('button', { name: /^login$/i }).click();

    await expect(page).toHaveURL(/\/therapist-dashboard$/);
      await expect(page.locator('h2', { hasText: /therapist dashboard/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /assigned cases/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /open messages/i })).toBeVisible();
  });
});