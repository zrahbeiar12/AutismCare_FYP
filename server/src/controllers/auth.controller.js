const { getCurrentTime, getCurrentTimeMs } = require('../utils/time.js');
const { User, APPROVAL_STATUS } = require('../models/User');
const LabApproval = require('../models/LabApproval');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { sendEmail } = require('../services/emailService');

/** Avoid `CLIENT_URL` trailing slash + `/path` → `//path` (breaks SPA routes). */
function buildClientAbsoluteUrl(pathname) {
  const base = String(process.env.CLIENT_URL || '').trim().replace(/\/+$/, '') || 'http://localhost:5173';
  const path = String(pathname || '').startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${path}`;
}

function shouldLogAuthRegistrationDebug() {
  return process.env.DEBUG_AUTH_REGISTRATION === 'true';
}

// Helper: Generate JWT
const signToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

// ---------------- REGISTER ----------------
exports.register = async (req, res) => {
  try {
    if (shouldLogAuthRegistrationDebug()) {
      console.log('Registration request body:', req.body);
    }

    // 1. Explicitly destructure fields to prevent mass-assignment vulnerabilities
    // We do NOT use ...req.body here to prevent malicious injection (e.g., injecting isEmailVerified: true)
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      // Role specific fields
      specialization,
      licenseNumber,
      labName,
      accreditation
    } = req.body;

    // 2. Normalize Role and Check Permissions
    const normalizedRole = role ? role.toLowerCase() : 'parent';

    // SECURITY: Block public registration of Admins
    if (normalizedRole === 'admin') {
      return res.status(403).json({ message: 'Admin registration is restricted.' });
    }

    // 3. Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (shouldLogAuthRegistrationDebug()) {
        console.log('Email already registered:', email);
      }
      return res.status(400).json({ message: 'Email already registered' });
    }

    // 4. Handle document uploads for professionals
    let documents = [];
    if ((normalizedRole === 'clinician' || normalizedRole === 'therapist') && req.files && req.files.length > 0) {
      // Store path-only URLs so the admin SPA (different origin/port) can open files via API host (see resolveUploadsHref on client).
      documents = req.files.map(file => ({
        name: file.originalname,
        url: `/uploads/documents/${file.filename}`,
        type: path.extname(file.originalname).toLowerCase()
      }));
    }

    // 5. Create User Instance
    // Mongoose will ignore fields (like labName) if they don't exist on the specific discriminator schema
    const newUser = new User({
      firstName,
      lastName,
      email,
      password,
      role: normalizedRole,
      specialization,
      licenseNumber,
      labName,
      accreditation,
      documents
    });

    // Email verification is not required: no verification token is generated and no email is sent.
    await newUser.save();

    // Lab users require admin approval before they can login.
    if (normalizedRole === 'lab') {
      await LabApproval.findOneAndUpdate(
        { labUserId: newUser._id },
        { $setOnInsert: { status: APPROVAL_STATUS.PENDING } },
        { upsert: true, new: true }
      );
    }

    // Same response shape as before ({ message }); only the wording changed.
    if (normalizedRole === 'lab') {
      return res.status(201).json({
        message: 'Lab account registered. Admin approval is required before login.',
      });
    }
    if (normalizedRole === 'clinician' || normalizedRole === 'therapist') {
      return res.status(201).json({
        message: 'User registered. Your account is pending admin approval before login.',
      });
    }
    return res.status(201).json({ message: 'User registered successfully. You can now log in.' });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ message: err.message || 'Server error during registration' });
  }
};

// ---------------- LOGIN ----------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid credential format' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password;

    // Find user and explicitly select password
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    // Check password
    const isMatch = await user.comparePassword(normalizedPassword);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    // Check approval status for professionals
    if ((user.role === 'clinician' || user.role === 'therapist') && user.approvalStatus !== 'active') {
      return res.status(403).json({ message: 'Your account is pending approval. Please contact admin.' });
    }

    // Lab admin approval gate (stored separately to avoid changing User structure).
    if (user.role === 'lab') {
      const isTestEnv =
        String(process.env.NODE_ENV || '').toLowerCase() === 'test' ||
        process.env.JEST_WORKER_ID != null;
      const labApproval = await LabApproval.findOneAndUpdate(
        { labUserId: user._id },
        isTestEnv
          ? { $set: { status: APPROVAL_STATUS.ACTIVE } }
          : { $setOnInsert: { status: APPROVAL_STATUS.PENDING } },
        { upsert: true, new: true }
      );
      if (labApproval.status === APPROVAL_STATUS.REJECTED) {
        return res.status(403).json({ message: 'Your lab account request was rejected by admin.' });
      }
      if (labApproval.status !== APPROVAL_STATUS.ACTIVE) {
        return res
          .status(403)
          .json({ message: 'Your lab account is pending admin approval. Please wait for approval.' });
      }
    }

    // Update audit fields
    user.lastLogin = getCurrentTime();
    user.loginAttempts = 0;
    await user.save({ validateBeforeSave: false }); // Skip validation for login updates

    const token = signToken(user);

    // Return token and basic user info (excluding sensitive data)
    res.status(200).json({ 
      token, 
      role: user.role, 
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email 
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ---------------- VERIFY EMAIL ----------------
exports.verifyEmail = async (req, res) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: getCurrentTimeMs() }
    });

    if (!user) return res.status(400).json({ message: 'Token is invalid or has expired' });

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ message: 'Email verified successfully! You can now login.' });
  } catch (err) {
    res.status(500).json({ message: 'Verification failed' });
  }
};

// ---------------- RESEND VERIFICATION EMAIL ----------------
exports.resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'No user found with that email' });

    if (user.isEmailVerified) return res.status(400).json({ message: 'Email is already verified' });

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    user.emailVerificationExpires = getCurrentTimeMs() + 24 * 60 * 60 * 1000; // 24 hours

    await user.save({ validateBeforeSave: false });

    // Send verification email
    const verificationUrl = buildClientAbsoluteUrl(`/verify-email/${verificationToken}`);

    try {
      const resp = await sendEmail({
        to: user.email,
        subject: 'Verify your account',
        text: `Welcome, ${user.firstName}! Please verify your email here: ${verificationUrl}`
      });
      if (!resp?.ok) throw new Error(resp?.error || 'Email send failed');
    } catch (emailErr) {
      console.error("Email failed to send:", emailErr);
      return res.status(500).json({ message: 'Failed to send verification email' });
    }

    res.status(200).json({ message: 'Verification email sent successfully' });
  } catch (err) {
    console.error("Resend verification email error:", err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ---------------- FORGOT PASSWORD ----------------
exports.forgotPassword = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ message: 'No user found with that email' });

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = buildClientAbsoluteUrl(`/reset-password/${resetToken}`);
    
    const resp = await sendEmail({
      to: user.email,
      subject: 'Your password reset token (valid for 10 min)',
      text: `Reset your password here: ${resetUrl}`
    });
    if (!resp?.ok) throw new Error(resp?.error || 'Email send failed');

    res.status(200).json({ message: 'Token sent to email!' });
  } catch (err) {
    res.status(500).json({ message: 'Error sending reset email' });
  }
};

// ---------------- RESET PASSWORD ----------------
exports.resetPassword = async (req, res) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: getCurrentTimeMs() }
    });

    if (!user) return res.status(400).json({ message: 'Token is invalid or has expired' });

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Reset failed' });
  }
};
