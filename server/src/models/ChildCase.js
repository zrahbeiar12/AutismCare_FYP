const mongoose = require('mongoose');
const { Schema } = mongoose;

const RISK_LEVEL = ['low', 'medium', 'high', 'unknown'];

const CASE_LIFECYCLE_STATUS = [
  'NEW',
  'SCREENING',
  'REVIEW',
  'DIAGNOSIS',
  'DIAGNOSIS_READY',
  'THERAPY',
  'THERAPY_ACTIVE',
  'MONITORING',
];

const ChildCaseSchema = new Schema(
  {
    childId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clinicianId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    therapistId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null,
    },
    screeningSummary: {
      type: Schema.Types.Mixed,
      default: {},
    },
    riskLevel: {
      type: String,
      enum: RISK_LEVEL,
      default: 'unknown',
      index: true,
    },
    status: {
      type: String,
      enum: CASE_LIFECYCLE_STATUS,
      default: 'NEW',
      index: true,
      set: (v) => {
        if (v == null) return v;
        const raw = String(v).trim();
        if (!raw) return raw;
        // Backward-compatible mapping from legacy status labels to lifecycle states.
        const key = raw.toLowerCase().replace(/\s+/g, '_');
        const legacyMap = {
          active: 'REVIEW',
          under_evaluation: 'REVIEW',
          referred: 'THERAPY',
          ongoing_therapy: 'THERAPY_ACTIVE',
        };
        return legacyMap[key] || raw;
      },
    },
    caseHistory: {
      type: [
        {
          fromStatus: { type: String, default: null },
          toStatus: { type: String, required: true },
          event: { type: String, required: true },
          context: { type: Schema.Types.Mixed, default: undefined },
          timestamp: { type: Date, default: Date.now },
          triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        },
      ],
      default: [],
    },
    screeningProgress: {
      mchatCompleted: { type: Boolean, default: false },
      asqCompleted: { type: Boolean, default: false },
      skippedMchat: { type: Boolean, default: false },
    },
    /** Organisation (hospital/clinic) the case is registered with. */
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    /** Permanent sequential file number, e.g. "CHL-2026-000123" (see services/caseFileNumberService.js). */
    fileNumber: { type: String, default: undefined, trim: true },
    fileYear: { type: Number, default: undefined },
    fileSeq: { type: Number, default: undefined },
    registeredAt: { type: Date, default: undefined },
    /** The hospital's own Medical Record (MR) number, entered by the clinician. Unique within an organisation. */
    mrNumber: { type: String, default: undefined, trim: true },
    /** Last progress-engine case recommendation text (for clinician caseload change detection). */
    progressEngineRecommendationSnapshot: { type: String, default: null },
    progressEngineRecommendationAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ChildCaseSchema.index({ parentId: 1, childId: 1 }, { unique: true });
ChildCaseSchema.index({ fileNumber: 1 }, { unique: true, partialFilterExpression: { fileNumber: { $type: 'string' } } });
ChildCaseSchema.index(
  { organizationId: 1, mrNumber: 1 },
  { unique: true, partialFilterExpression: { mrNumber: { $type: 'string' } } }
);

module.exports = {
  ChildCase: mongoose.model('ChildCase', ChildCaseSchema),
  CASE_LIFECYCLE_STATUS,
  CASE_RISK_LEVELS: RISK_LEVEL,
};
