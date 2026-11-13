const mongoose = require('mongoose');
const { Schema } = mongoose;

const REPORT_TYPES = ['monthly', 'iep', 'clinician', 'parent', 'progress', 'session', 'therapy', 'integrated'];

const ReportSchema = new Schema(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: 'ChildCase',
      required: true,
      index: true,
    },
    therapistId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: REPORT_TYPES,
      required: true,
      index: true,
    },
    /** Full structured payload: { type, generatedAt, insufficientData?, ...sections } */
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    /** Relative web path to generated PDF (e.g. /uploads/reports/{id}.pdf) */
    pdfRelativePath: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * caseId:therapistId:type:<45 s window>. Unique, so two simultaneous "generate" clicks cannot both create a
     * report: the second insert fails and the API returns the first one as a duplicate.
     */
    dedupeKey: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true }
);

ReportSchema.index({ caseId: 1, type: 1, createdAt: -1 });
ReportSchema.index({ caseId: 1, therapistId: 1, type: 1, createdAt: -1 });

ReportSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

const Report = mongoose.model('Report', ReportSchema);


module.exports = { Report, REPORT_TYPES };
