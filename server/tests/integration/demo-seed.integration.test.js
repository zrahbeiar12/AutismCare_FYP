const request = require('supertest');

jest.mock('../../src/utils/email', () => {
  const sendEmail = jest.fn().mockResolvedValue(true);
  sendEmail.sendEmailWithAttachments = jest.fn().mockResolvedValue(true);
  return sendEmail;
});

const { app } = require('../../src/server');
const { User } = require('../../src/models/User');
const { ChildCase } = require('../../src/models/ChildCase');
const SessionLog = require('../../src/models/SessionLog');
const Questionnaire = require('../../src/models/Questionnaire');
const { seedDemoData, DEMO_EMAILS } = require('../../src/seeders/demoSeed');
const { connectTestDb, disconnectTestDb } = require('../helpers/testDb');

describe('Demo data seeder', () => {
  const password = 'DemoPass#2026';

  beforeAll(async () => {
    await connectTestDb();
    await User.deleteMany({ email: { $in: Object.values(DEMO_EMAILS) } });
  });

  afterAll(async () => {
    delete process.env.DEMO_PASSWORD;
    const parent = await User.findOne({ email: DEMO_EMAILS.parent }).lean();
    if (parent) await ChildCase.deleteMany({ parentId: parent._id });
    await User.deleteMany({ email: { $in: Object.values(DEMO_EMAILS) } });
    await disconnectTestDb();
  });

  test('does nothing without DEMO_PASSWORD', async () => {
    delete process.env.DEMO_PASSWORD;
    const res = await seedDemoData({ log: () => {} });
    expect(res.seeded).toBe(false);
    expect(await User.exists({ email: DEMO_EMAILS.parent })).toBeNull();
  });

  test("creates Hamza's full case once, and a second run changes nothing", async () => {
    process.env.DEMO_PASSWORD = password;
    const first = await seedDemoData({ log: () => {} });
    expect(first.seeded).toBe(true);

    const hamza = await ChildCase.findById(first.caseIds[0]).lean();
    expect(hamza.status).toBe('THERAPY_ACTIVE');
    expect(hamza.fileNumber).toMatch(/^[A-Z0-9]+-\d{4}-\d{6}$/);
    expect(await SessionLog.countDocuments({ caseId: hamza._id })).toBe(4);
    expect(await Questionnaire.exists({ name: 'MCHAT-R' })).toBeTruthy();

    const counts = async () => ({
      users: await User.countDocuments({ email: { $in: Object.values(DEMO_EMAILS) } }),
      cases: await ChildCase.countDocuments({ parentId: hamza.parentId }),
      sessions: await SessionLog.countDocuments({ caseId: hamza._id }),
    });
    const before = await counts();
    const second = await seedDemoData({ log: () => {} });
    expect(second.seeded).toBe(false);
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ users: 5, cases: 2, sessions: 4 });
  });

  test('every demo account can log in', async () => {
    for (const email of Object.values(DEMO_EMAILS)) {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      expect({ email, status: res.statusCode }).toEqual({ email, status: 200 });
    }
  });
});
