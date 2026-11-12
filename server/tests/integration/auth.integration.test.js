const request = require('supertest');
jest.mock('../../src/utils/email', () => jest.fn().mockResolvedValue(true));
const { app } = require('../../src/server');
const { User } = require('../../src/models/User');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser, loginUser } = require('../helpers/authHelpers');

describe('Auth Integration', () => {
  const suffix = Date.now();
  const password = 'Password123!';
  const parentEmail = `parent.auth.${suffix}@test.com`;

  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await User.deleteMany({ email: new RegExp(`\\.${suffix}@test\\.com$`) });
    await disconnectTestDb();
  });

  test('registers a parent', async () => {
    const res = await registerUser(app, {
      firstName: 'Parent',
      lastName: 'Auth',
      email: parentEmail,
      password,
      role: 'parent',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.message).toMatch(/registered/i);
  });

  test('allows login immediately after registration (no email verification)', async () => {
    const res = await loginUser(app, parentEmail, password);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.role).toBe('parent');
  });

  test('does not store the password in plain text', async () => {
    const stored = await User.findOne({ email: parentEmail }).select('+password').lean();
    expect(stored.password).not.toBe(password);
    expect(stored.password).toMatch(/^\$2[aby]\$/);
  });

  test('rejects an incorrect password', async () => {
    const res = await loginUser(app, parentEmail, 'WrongPassword999!');
    expect(res.statusCode).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test('rejects duplicate email registration (including different letter case)', async () => {
    const payload = { firstName: 'Dup', lastName: 'User', password, role: 'parent' };
    const same = await registerUser(app, { ...payload, email: parentEmail });
    expect(same.statusCode).toBe(400);
    const upper = await registerUser(app, { ...payload, email: parentEmail.toUpperCase() });
    expect(upper.statusCode).toBe(400);
  });

  test('issued JWT grants access to a protected route and missing/invalid tokens are rejected', async () => {
    const login = await loginUser(app, parentEmail, password);
    const ok = await request(app).get('/api/parent/cases').set('Authorization', `Bearer ${login.body.token}`);
    expect(ok.statusCode).toBe(200);

    const none = await request(app).get('/api/parent/cases');
    expect(none.statusCode).toBe(401);

    const bad = await request(app).get('/api/parent/cases').set('Authorization', 'Bearer a.b.c');
    expect(bad.statusCode).toBe(401);
  });

  test('role-based access: parent token is denied on admin routes', async () => {
    const login = await loginUser(app, parentEmail, password);
    const res = await request(app).get('/api/admin/dashboard-metrics').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.statusCode).toBe(403);
  });

  test('clinician still requires admin approval after registration', async () => {
    const email = `clinician.auth.${suffix}@test.com`;
    const reg = await registerUser(app, {
      firstName: 'Clin',
      lastName: 'Auth',
      email,
      password,
      role: 'clinician',
      specialization: 'Pediatrics',
      licenseNumber: `LIC-${suffix}`,
    });
    expect(reg.statusCode).toBe(201);
    const res = await loginUser(app, email, password);
    expect(res.statusCode).toBe(403);
    expect(String(res.body.message || '')).toMatch(/approval/i);
  });

  test('rejects public admin registration', async () => {
    const res = await registerUser(app, {
      firstName: 'Admin',
      lastName: 'Blocked',
      email: `admin.blocked.${suffix}@test.com`,
      password,
      role: 'admin',
    });

    expect(res.statusCode).toBe(403);
  });

  test('returns invalid token response for verify-email with bad token', async () => {
    const res = await request(app).get('/api/auth/verify-email/bad-token-value');
    expect([400, 500]).toContain(res.statusCode);
  });
});
