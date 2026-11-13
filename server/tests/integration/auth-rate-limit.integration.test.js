const request = require('supertest');

jest.mock('../../src/utils/email', () => {
  const sendEmail = jest.fn().mockResolvedValue(true);
  sendEmail.sendEmailWithAttachments = jest.fn().mockResolvedValue(true);
  return sendEmail;
});

const { app } = require('../../src/server');
const { User } = require('../../src/models/User');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');
const { registerUser, activateUser } = require('../helpers/authHelpers');

describe('Login brute-force protection', () => {
  const suffix = Date.now();
  const email = `ratelimit.${suffix}@test.com`;
  const other = `ratelimit.other.${suffix}@test.com`;
  const password = 'Password123!';

  beforeAll(async () => {
    await connectTestDb();
    await registerUser(app, { firstName: 'Rate', lastName: 'Limit', email, password, role: 'parent' });
    await registerUser(app, { firstName: 'Other', lastName: 'User', email: other, password, role: 'parent' });
    await activateUser(email);
    await activateUser(other);
    process.env.ENABLE_AUTH_RATE_LIMIT = '1';
  });

  afterAll(async () => {
    delete process.env.ENABLE_AUTH_RATE_LIMIT;
    await User.deleteMany({ email: { $in: [email, other] } });
    await disconnectTestDb();
  });

  test('10 wrong passwords are answered normally, the 11th is blocked; other accounts are unaffected', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/api/auth/login').send({ email, password: `wrong-${i}` });
      expect(res.statusCode).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email, password });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body.message).toMatch(/too many failed login attempts/i);

    const otherOk = await request(app).post('/api/auth/login').send({ email: other, password });
    expect(otherOk.statusCode).toBe(200);
  });

  test('a session token expires in hours, not days', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: other, password });
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(12 * 60 * 60);
  });
});
