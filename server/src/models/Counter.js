const mongoose = require('mongoose');
const { Schema } = mongoose;

/** Atomic sequence counters, e.g. `caseFile:<organizationId>:2026` → last file number issued that year. */
const CounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);
