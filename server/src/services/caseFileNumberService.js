/**
 * Organisations and sequential case file numbers.
 *
 * Every child case registered with a clinic gets a permanent file number: `<ORG CODE>-<YEAR>-<000001>`, counting up
 * per organisation per year in registration order. Numbers come from an atomic counter (`$inc`), so two clinicians
 * registering at the same moment can never receive the same number, and a number is only taken for a case that
 * does not already have one. These numbers are what make the data usable as a registry later.
 */
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Counter = require('../models/Counter');
const { ChildCase } = require('../models/ChildCase');
const { User } = require('../models/User');

const DEFAULT_ORG_NAME = () => process.env.ORG_NAME || 'AutismCare';
const DEFAULT_ORG_CODE = () => String(process.env.ORG_CODE || 'AC').toUpperCase();

let defaultOrgCache = null;

/** The organisation used when a deployment serves a single hospital, or a user has not been assigned one. */
async function getDefaultOrganization() {
  if (defaultOrgCache) return defaultOrgCache;
  let org = await Organization.findOne({ isDefault: true }).lean();
  if (!org) {
    try {
      org = (await Organization.create({ name: DEFAULT_ORG_NAME(), code: DEFAULT_ORG_CODE(), isDefault: true })).toObject();
    } catch (err) {
      // Another process created it first (unique code) — read it back.
      org = await Organization.findOne({ $or: [{ isDefault: true }, { code: DEFAULT_ORG_CODE() }] }).lean();
    }
  }
  defaultOrgCache = org;
  return org;
}

function resetDefaultOrganizationCache() {
  defaultOrgCache = null;
}

async function organizationForUser(userId) {
  if (userId && mongoose.Types.ObjectId.isValid(String(userId))) {
    const u = await User.findById(userId).select('organizationId').lean();
    if (u?.organizationId) {
      const org = await Organization.findById(u.organizationId).lean();
      if (org) return org;
    }
  }
  return getDefaultOrganization();
}

function formatFileNumber(code, year, seq) {
  return `${code}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Register a case with an organisation and give it the next file number, if it has none yet.
 * The organisation is the clinician's (or the given one, or the default). Safe to call repeatedly.
 * @returns {Promise<object|null>} the updated case, or null if the case does not exist
 */
async function assignCaseFileNumber(caseId, { organizationId = null, clinicianId = null } = {}) {
  const existing = await ChildCase.findById(caseId).select('fileNumber organizationId clinicianId createdAt').lean();
  if (!existing) return null;
  if (existing.fileNumber) return existing;

  let org = null;
  if (organizationId) org = await Organization.findById(organizationId).lean();
  if (!org && existing.organizationId) org = await Organization.findById(existing.organizationId).lean();
  if (!org) org = await organizationForUser(clinicianId || existing.clinicianId);

  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: `caseFile:${org._id}:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean();
  const fileNumber = formatFileNumber(org.code, year, counter.seq);

  const updated = await ChildCase.findOneAndUpdate(
    { _id: caseId, $or: [{ fileNumber: null }, { fileNumber: { $exists: false } }] },
    { $set: { fileNumber, fileYear: year, fileSeq: counter.seq, organizationId: org._id, registeredAt: new Date() } },
    { new: true }
  ).lean();
  if (updated) return updated;

  // Another request numbered this case between our read and write: give the number back if it is still the latest.
  await Counter.updateOne({ _id: `caseFile:${org._id}:${year}`, seq: counter.seq }, { $inc: { seq: -1 } });
  return ChildCase.findById(caseId).lean();
}

/**
 * Number every case that is linked to a clinician but has no file number yet, oldest first, so existing data gets
 * numbers in the order the cases were created. Idempotent; runs at server start.
 */
async function backfillCaseFileNumbers() {
  const pending = await ChildCase.find({
    clinicianId: { $ne: null },
    $or: [{ fileNumber: null }, { fileNumber: { $exists: false } }],
  })
    .select('_id clinicianId')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  for (const c of pending) {
    // eslint-disable-next-line no-await-in-loop
    await assignCaseFileNumber(c._id, { clinicianId: c.clinicianId });
  }
  return pending.length;
}

module.exports = {
  getDefaultOrganization,
  resetDefaultOrganizationCache,
  organizationForUser,
  assignCaseFileNumber,
  backfillCaseFileNumbers,
  formatFileNumber,
};
