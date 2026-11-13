/**
 * GET /api/referrals/:id/letter — printable referral letter (PDF) on the organisation's letterhead.
 * Readable by the referring clinician, a therapist with access to the case, and admins.
 */
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { Referral } = require('../models/Referral');
const { ChildCase } = require('../models/ChildCase');
const { User } = require('../models/User');
const { ClinicalEvaluation } = require('../models/ClinicalEvaluation');
const Organization = require('../models/Organization');
const { assertTherapistCaseAccess } = require('../utils/therapistCaseAccess');
const { loadLatestScreeningsForChildren } = require('../services/childCase.service');
const { getDefaultOrganization } = require('../services/caseFileNumberService');
const { diagnosisText, evaluationText } = require('../utils/evaluationText');

const NAVY = '#1E3A8A';
const GOLD = '#D4AF37';
const INK = '#0F172A';
const BODY = '#334155';
const MUTED = '#64748B';
const LINE = '#D6DCE5';

const t = (v) => String(v == null ? '' : v).replace(/→/g, 'to').replace(/\s+/g, ' ').trim();
const fullName = (p) => t(`${p?.firstName || ''} ${p?.lastName || ''}`) || '—';
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
function ageText(dob) {
  if (!dob) return '—';
  const b = new Date(dob);
  const now = new Date();
  let m = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) m -= 1;
  const y = Math.floor(m / 12);
  return y ? `${y} y ${m % 12} m` : `${m} months`;
}

function renderLetter(doc, d) {
  const L = 56;
  const W = doc.page.width - L * 2;
  let y = 48;
  const text = (s, x, yy, o = {}) => {
    doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor(o.color || BODY).text(t(s), x, yy, { width: o.width || W, align: o.align, lineGap: 2 });
    return doc.y;
  };

  // Letterhead
  text(d.org.name, L, y, { size: 16, bold: true, color: NAVY });
  const contact = [d.org.address, d.org.city, d.org.phone].map(t).filter(Boolean).join(' · ');
  if (contact) text(contact, L, y + 20, { size: 9, color: MUTED });
  text('AutismCare', L, y + 2, { size: 9, bold: true, color: GOLD, align: 'right' });
  y += 40;
  doc.save().rect(L, y, W, 2).fill(NAVY).restore();
  doc.save().rect(L, y + 2, W, 1).fill(GOLD).restore();
  y += 16;

  text('REFERRAL FOR THERAPY', L, y, { size: 13, bold: true, color: INK });
  text(`Date: ${fmtDate(d.date)}`, L, y + 2, { size: 9, color: MUTED, align: 'right' });
  y += 22;

  const refs = [`File no: ${d.fileNumber || '—'}`, `MR no: ${d.mrNumber || '—'}`, `Priority: ${d.priority}`].join('   |   ');
  text(refs, L, y, { size: 9.5, bold: true, color: NAVY });
  y += 20;

  text(`To: ${d.toLine}`, L, y, { size: 10.5, color: INK });
  y = doc.y + 12;

  // Patient box
  const rows = [
    ['Child', d.childName],
    ['Date of birth / age', `${fmtDate(d.dob)} (${ageText(d.dob)})`],
    ['Gender', d.gender],
    ['Parent / guardian', `${d.parentName}${d.parentPhone ? ` · ${d.parentPhone}` : ''}`],
  ];
  const boxH = 14 + rows.length * 16;
  doc.save().roundedRect(L, y, W, boxH, 5).fill('#F5F7FB').restore();
  rows.forEach(([k, v], i) => {
    text(k, L + 12, y + 8 + i * 16, { size: 9, color: MUTED, width: 130 });
    text(v || '—', L + 150, y + 8 + i * 16, { size: 10, color: INK, width: W - 165, bold: k === 'Child' });
  });
  y += boxH + 16;

  const section = (title, body) => {
    if (!body) return;
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = 56;
    }
    text(title, L, y, { size: 10.5, bold: true, color: NAVY });
    y = text(body, L, doc.y + 3, { size: 10, color: BODY }) + 10;
  };

  text('Dear colleague,', L, y, { color: INK });
  y = doc.y + 6;
  y = text(
    `I am referring ${d.childFirst} for assessment and therapy by a ${d.therapistType}. A summary of the clinical findings is below; please contact me if you need more information.`,
    L,
    y
  ) + 12;

  section('Reason for referral', d.notes || 'As per clinical evaluation below.');
  section('Clinical impression', d.diagnosis);
  section('Developmental summary', d.developmental);
  section('Screening results', d.screeningLine);
  section('Recommendations', d.recommendations);

  // Signature
  if (y > doc.page.height - 150) {
    doc.addPage();
    y = 56;
  }
  y += 18;
  text('Yours sincerely,', L, y, { color: INK });
  y += 42;
  doc.save().moveTo(L, y).lineTo(L + 200, y).lineWidth(0.8).strokeColor(INK).stroke().restore();
  text(d.clinicianName, L, y + 6, { size: 10.5, bold: true, color: INK });
  text([d.clinicianSpecialization, d.clinicianLicense ? `Licence no: ${d.clinicianLicense}` : ''].filter(Boolean).join(' · '), L, doc.y + 1, { size: 9, color: MUTED });
  text(d.org.name, L, doc.y + 1, { size: 9, color: MUTED });

  // Footer
  const fy = doc.page.height - 50;
  doc.save().moveTo(L, fy - 6).lineTo(L + W, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke().restore();
  doc.page.margins.bottom = 0;
  text('Confidential medical information. Screening results support clinical judgement and are not a diagnosis.', L, fy, {
    size: 7.5,
    color: MUTED,
  });
}

exports.getReferralLetter = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid referral id' });
    const referral = await Referral.findById(id).lean();
    if (!referral) return res.status(404).json({ success: false, message: 'Referral not found' });

    const role = String(req.user?.role || req.jwtRole || '').toLowerCase();
    let allowed = role === 'admin' || (role === 'clinician' && String(referral.clinicianId) === String(req.user._id));
    if (!allowed && role === 'therapist') {
      allowed = (await assertTherapistCaseAccess(req, String(referral.caseId), req.user._id)).ok;
    }
    if (!allowed) return res.status(403).json({ success: false, message: 'Access denied' });

    const caseDoc = await ChildCase.findById(referral.caseId).lean();
    if (!caseDoc) return res.status(404).json({ success: false, message: 'Case not found' });

    const [parent, clinician, therapist, evaluation, screeningsByChild] = await Promise.all([
      User.findById(caseDoc.parentId).select('firstName lastName phoneNumber children').lean(),
      User.findById(referral.clinicianId).select('firstName lastName specialization licenseNumber organizationId').lean(),
      caseDoc.therapistId ? User.findById(caseDoc.therapistId).select('firstName lastName specialization').lean() : null,
      ClinicalEvaluation.findOne({ caseId: caseDoc._id, status: 'FINALIZED' }).sort({ createdAt: -1 }).lean(),
      loadLatestScreeningsForChildren([caseDoc.childId]),
    ]);
    const org =
      (caseDoc.organizationId && (await Organization.findById(caseDoc.organizationId).lean())) ||
      (clinician?.organizationId && (await Organization.findById(clinician.organizationId).lean())) ||
      (await getDefaultOrganization());
    const child = (parent?.children || []).find((c) => String(c._id) === String(caseDoc.childId)) || {};

    const sc = screeningsByChild.get(String(caseDoc.childId)) || {};
    const parts = [];
    if (sc.mchat) parts.push(`M-CHAT-R ${sc.mchat.totalScore ?? '—'}/20 (${sc.mchat.riskLevel} likelihood, ${fmtDate(sc.mchat.completedAt)})`);
    if (sc.asq3) {
      const flagged = (sc.asq3.domains || []).filter((x) => x.zone === 'refer' || x.zone === 'monitor');
      parts.push(
        `ASQ-3 ${sc.asq3.intervalMonths ? `${sc.asq3.intervalMonths}-month` : ''} (${fmtDate(sc.asq3.completedAt)}): ` +
          (flagged.length
            ? flagged.map((x) => `${x.domain} ${x.score}/60 ${x.zone === 'refer' ? 'below cutoff' : 'monitoring zone'}`).join('; ')
            : 'all domains in the typical range')
      );
    }

    const toName = therapist && /accepted|in-progress/i.test(String(referral.status)) ? `${fullName(therapist)}, ` : '';
    const data = {
      org,
      date: referral.createdAt,
      fileNumber: caseDoc.fileNumber,
      mrNumber: caseDoc.mrNumber,
      priority: t(referral.priority).replace(/^\w/, (c) => c.toUpperCase()) || '—',
      toLine: `${toName}${referral.therapistType}`,
      therapistType: referral.therapistType || 'Therapist',
      childName: fullName(child),
      childFirst: t(child.firstName) || 'this child',
      dob: child.dateOfBirth,
      gender: t(child.gender).replace(/^\w/, (c) => c.toUpperCase()) || '—',
      parentName: fullName(parent),
      parentPhone: t(parent?.phoneNumber),
      notes: t(referral.notes),
      diagnosis: evaluation ? diagnosisText(evaluation.diagnosis) : '',
      developmental: evaluation ? evaluationText(evaluation.developmentalSummary) : '',
      recommendations: evaluation ? evaluationText(evaluation.recommendations) : '',
      screeningLine: parts.join('\n'),
      clinicianName: fullName(clinician),
      clinicianSpecialization: t(clinician?.specialization),
      clinicianLicense: t(clinician?.licenseNumber),
    };

    const safe = (data.childName || 'child').replace(/[^A-Za-z0-9]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Referral_${safe}_${data.fileNumber || id}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Referral — ${data.childName}`, Author: t(org.name) } });
    doc.pipe(res);
    renderLetter(doc, data);
    doc.end();
    return undefined;
  } catch (error) {
    console.error('getReferralLetter:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Failed to create referral letter' });
    return undefined;
  }
};
