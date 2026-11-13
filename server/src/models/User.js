const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Schema } = mongoose;

const ROLES = {
  ADMIN: 'admin',
  CLINICIAN: 'clinician',
  THERAPIST: 'therapist',
  LAB: 'lab',
  PARENT: 'parent'
};

const APPROVAL_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  REJECTED: 'rejected'
};

const DocumentSchema = new Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  type: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

const UserSchema = new Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email'],
    index: true
  },
  password: { type: String, required: true, minlength: 8, select: false },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  phoneNumber: { type: String, trim: true },
  role: { type: String, enum: Object.values(ROLES), required: true, index: true },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  /** Hospital/clinic this staff member works for (parents have none; their cases carry the organisation). */
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
}, {
  timestamps: true,
  discriminatorKey: 'role' // This connects the sub-schemas
});

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', UserSchema);

// Discriminators
User.discriminator(ROLES.CLINICIAN, new Schema({
  specialization: { type: String, required: true },
  licenseNumber: { type: String, required: true, unique: true },
  approvalStatus: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
  documents: [DocumentSchema]
}));

User.discriminator(ROLES.THERAPIST, new Schema({
  specialization: { type: String, required: true },
  licenseNumber: { type: String, required: true },
  approvalStatus: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
  documents: [DocumentSchema]
}));

User.discriminator(ROLES.PARENT, new Schema({
  insuranceProvider: String,
  policyNumber: String,
  children: [new Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    pretermWeeks: { type: Number, default: 0 },
    medicalHistory: String,
    allergies: String,
    currentMedications: String,
    emergencyContact: { type: String, required: true },
    emergencyPhone: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }, { _id: true })]
}));

User.discriminator(ROLES.LAB, new Schema({
  labName: { type: String, required: true },
  accreditation: String
}));

module.exports = { User, ROLES, APPROVAL_STATUS };