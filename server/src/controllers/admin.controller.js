const { User, APPROVAL_STATUS } = require('../models/User');
const mongoose = require('mongoose');
const { recordAuditEvent } = require('../utils/auditLog');
const LabApproval = require('../models/LabApproval');
const { Appointment } = require('../models/Appointment');
const { APPOINTMENT_STATUS } = require('../constants/workflowEnums');

// Get all pending professionals
exports.getPendingProfessionals = async (req, res) => {
  try {
    const pendingUsers = await User.find({
      role: { $in: ['clinician', 'therapist'] },
      approvalStatus: APPROVAL_STATUS.PENDING
    }).select('firstName lastName email role specialization licenseNumber documents createdAt');

    const pendingLabs = await LabApproval.find({ status: APPROVAL_STATUS.PENDING })
      .populate({
        path: 'labUserId',
        select: 'firstName lastName email role labName accreditation createdAt',
        match: { role: 'lab' },
      })
      .lean();

    const labUsersFromApproval = pendingLabs
      .filter((row) => row.labUserId)
      .map((row) => ({
        _id: row.labUserId._id,
        firstName: row.labUserId.firstName,
        lastName: row.labUserId.lastName,
        email: row.labUserId.email,
        role: 'lab',
        labName: row.labUserId.labName || '',
        accreditation: row.labUserId.accreditation || '',
        createdAt: row.labUserId.createdAt || row.createdAt,
      }));

    const approvedLabIds = new Set(labUsersFromApproval.map((row) => String(row._id)));
    const untrackedLabs = await User.find({
      role: 'lab',
      _id: { $nin: [...approvedLabIds] },
    }).select('firstName lastName email role labName accreditation createdAt');
    const labUsers = [
      ...labUsersFromApproval,
      ...untrackedLabs.map((row) => ({
        _id: row._id,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        role: 'lab',
        labName: row.labName || '',
        accreditation: row.accreditation || '',
        createdAt: row.createdAt,
      })),
    ];

    res.status(200).json({ users: [...pendingUsers, ...labUsers] });
  } catch (err) {
    console.error("Get pending professionals error:", err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Approve or reject professional
exports.updateProfessionalStatus = async (req, res) => {
  try {
    const { userId, status } = req.body;

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    if (!Object.values(APPROVAL_STATUS).includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findById(userId);
    if (!user || !['clinician', 'therapist', 'lab'].includes(user.role)) {
      return res.status(404).json({ message: 'User not found or not an approvable professional' });
    }

    let before = {};
    let after = {};
    if (user.role === 'lab') {
      const existingBefore = await LabApproval.findOne({ labUserId: user._id }).lean();
      const existing = await LabApproval.findOneAndUpdate(
        { labUserId: user._id },
        {
          $set: {
            status,
            reviewedBy: req.user?._id || null,
            reviewedAt: new Date(),
          },
          $setOnInsert: { labUserId: user._id },
        },
        { upsert: true, new: true }
      );
      before = { approvalStatus: existingBefore?.status || APPROVAL_STATUS.PENDING };
      after = { approvalStatus: status };
    } else {
      before = { approvalStatus: user.approvalStatus };
      user.approvalStatus = status;
      await user.save({ validateBeforeSave: false });
      after = { approvalStatus: status };
    }

    try {
      await recordAuditEvent({
        req,
        actorId: req.user?._id,
        action: status === APPROVAL_STATUS.ACTIVE ? 'admin_approval' : 'admin_rejection',
        entityType: 'User',
        entityId: user._id,
        summary: `professional=${String(user.role)} status=${String(status)}`,
        before,
        after,
      });
    } catch (e) {
      console.error('audit admin professional approval:', e);
    }

    res.status(200).json({ message: `User ${status} successfully` });
  } catch (err) {
    console.error("Update professional status error:", err);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/admin/dashboard-metrics
 * Lightweight counts for admin home cards (no mock UI data).
 */
exports.getDashboardMetrics = async (req, res) => {
  try {
    const [pendingClinicianTherapist, pendingLabApprovals, apptTotal, apptPending, apptCompleted, activeClinicianTherapist, activeLabs] =
      await Promise.all([
        User.countDocuments({
          role: { $in: ['clinician', 'therapist'] },
          approvalStatus: APPROVAL_STATUS.PENDING,
        }),
        LabApproval.countDocuments({ status: APPROVAL_STATUS.PENDING }),
        Appointment.countDocuments(),
        Appointment.countDocuments({ status: APPOINTMENT_STATUS.PENDING }),
        Appointment.countDocuments({ status: APPOINTMENT_STATUS.COMPLETED }),
        User.countDocuments({
          role: { $in: ['clinician', 'therapist'] },
          approvalStatus: APPROVAL_STATUS.ACTIVE,
        }),
        // A lab's approval is stored in LabApproval, not on the user document.
        LabApproval.countDocuments({ status: APPROVAL_STATUS.ACTIVE }),
      ]);

    const pendingApprovals = pendingClinicianTherapist + pendingLabApprovals;
    const activeProfessionals = activeClinicianTherapist + activeLabs;

    return res.status(200).json({
      success: true,
      data: {
        pendingApprovals,
        appointmentsTotal: apptTotal,
        appointmentsPending: apptPending,
        appointmentsCompleted: apptCompleted,
        activeProfessionals,
      },
    });
  } catch (err) {
    console.error('getDashboardMetrics:', err);
    return res.status(500).json({ success: false, message: 'Failed to load dashboard metrics' });
  }
};

/**
 * GET /api/admin/users?page&limit&role&status&q
 * Paginated user directory for the admin User Management screen. Lab approval lives in LabApproval,
 * so a lab's status is read from there (labs without a record are still pending).
 */
exports.listUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim();

    const filter = {};
    if (role) {
      if (!['admin', 'clinician', 'therapist', 'parent', 'lab'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role filter' });
      }
      filter.role = role;
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }
    if (status && !Object.values(APPROVAL_STATUS).includes(status)) {
      return res.status(400).json({ message: 'Invalid status filter' });
    }

    const docs = await User.find(filter)
      .select('firstName lastName email role approvalStatus specialization labName createdAt organizationId')
      .sort({ createdAt: -1 })
      .lean();

    const labIds = docs.filter((u) => u.role === 'lab').map((u) => u._id);
    const labApprovals = labIds.length ? await LabApproval.find({ labUserId: { $in: labIds } }).select('labUserId status').lean() : [];
    const labStatus = new Map(labApprovals.map((l) => [String(l.labUserId), l.status]));

    const rows = docs.map((u) => ({
      _id: u._id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      specialization: u.specialization || u.labName || '',
      organizationId: u.organizationId || null,
      approvalStatus:
        u.role === 'lab'
          ? labStatus.get(String(u._id)) || APPROVAL_STATUS.PENDING
          : ['clinician', 'therapist'].includes(u.role)
            ? u.approvalStatus || APPROVAL_STATUS.PENDING
            : undefined,
      createdAt: u.createdAt,
    }));
    const filtered = status ? rows.filter((r) => r.approvalStatus === status) : rows;
    const total = filtered.length;
    return res.status(200).json({
      users: filtered.slice((page - 1) * limit, page * limit),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('listUsers:', error);
    return res.status(500).json({ message: 'Failed to load users' });
  }
};

/* ───────────── Organisations (hospitals / clinics) ───────────── */
const Organization = require('../models/Organization');
const { getDefaultOrganization } = require('../services/caseFileNumberService');

/** GET /api/admin/organizations */
exports.listOrganizations = async (req, res) => {
  try {
    await getDefaultOrganization();
    const orgs = await Organization.find({}).sort({ isDefault: -1, name: 1 }).lean();
    const counts = await User.aggregate([
      { $match: { organizationId: { $ne: null } } },
      { $group: { _id: '$organizationId', n: { $sum: 1 } } },
    ]);
    const staff = new Map(counts.map((c) => [String(c._id), c.n]));
    return res.status(200).json({ success: true, data: orgs.map((o) => ({ ...o, staffCount: staff.get(String(o._id)) || 0 })) });
  } catch (error) {
    console.error('listOrganizations:', error);
    return res.status(500).json({ success: false, message: 'Failed to load organisations' });
  }
};

/** POST /api/admin/organizations { name, code, city?, address?, phone? } */
exports.createOrganization = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!/^[A-Z0-9]{2,8}$/.test(code)) {
      return res.status(400).json({ success: false, message: 'Code must be 2–8 letters or digits (used in file numbers)' });
    }
    const org = await Organization.create({
      name,
      code,
      city: String(req.body?.city || '').trim(),
      address: String(req.body?.address || '').trim(),
      phone: String(req.body?.phone || '').trim(),
    });
    return res.status(201).json({ success: true, data: org });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'An organisation with this code already exists' });
    }
    console.error('createOrganization:', error);
    return res.status(500).json({ success: false, message: 'Failed to create organisation' });
  }
};

/** PUT /api/admin/users/:id/organization { organizationId } — assign a staff member to an organisation. */
exports.setUserOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(String(organizationId || ''))) {
      return res.status(400).json({ success: false, message: 'Valid user id and organizationId are required' });
    }
    const org = await Organization.findById(organizationId).lean();
    if (!org) return res.status(404).json({ success: false, message: 'Organisation not found' });
    const user = await User.findById(id).select('role').lean();
    if (!user || user.role === 'parent') {
      return res.status(400).json({ success: false, message: 'Only staff accounts belong to an organisation' });
    }
    await User.updateOne({ _id: id }, { $set: { organizationId: org._id } });
    return res.status(200).json({ success: true, data: { userId: id, organizationId: org._id, organizationCode: org.code } });
  } catch (error) {
    console.error('setUserOrganization:', error);
    return res.status(500).json({ success: false, message: 'Failed to assign organisation' });
  }
};
