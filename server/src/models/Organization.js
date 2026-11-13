const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A hospital, clinic or centre using AutismCare. Staff belong to one organisation; each child case is registered
 * with one and gets that organisation's next file number (e.g. CHL-2026-000123).
 */
const OrganizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Short uppercase code used in file numbers, e.g. "CHL". */
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9]{2,8}$/, 'Code must be 2–8 letters or digits'],
      unique: true,
    },
    city: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    isDefault: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Organization || mongoose.model('Organization', OrganizationSchema);
