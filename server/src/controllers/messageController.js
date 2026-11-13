const { getCurrentTime, getCurrentTimeMs } = require('../utils/time.js');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { ChildCase } = require('../models/ChildCase');
const TherapyCase = require('../models/TherapyCase');
const { HomeAssignment } = require('../models/HomeAssignment');
const { User } = require('../models/User');
const { assertTherapistCaseAccess } = require('../utils/therapistCaseAccess');
const { createNotification } = require('../utils/notification');
const { NOTIFICATION_TYPES } = require('../models/Notification');

async function assertParentOwnsCase(parentId, caseId) {
  return ChildCase.findOne({ _id: caseId, parentId }).select('_id parentId childId').lean();
}

async function assertClinicianOwnsCase(clinicianId, caseId) {
  return ChildCase.findOne({ _id: caseId, clinicianId }).select('_id clinicianId childId parentId').lean();
}

/**
 * Active therapy case → latest assignment; required to open a thread.
 */
async function resolveTherapistIdForCase(caseId) {
  const tc = await TherapyCase.findOne({ caseId, status: 'ACTIVE' }).sort({ updatedAt: -1 }).lean();
  if (tc?.therapistId) return tc.therapistId;
  const ha = await HomeAssignment.findOne({ caseId }).sort({ updatedAt: -1 }).lean();
  if (ha?.therapistId) return ha.therapistId;
  return null;
}

function childNameFromParent(parent, childId) {
  if (!parent || !Array.isArray(parent.children) || !childId) return 'Child';
  const found = parent.children.find((c) => c && c._id && c._id.toString() === childId.toString());
  if (!found) return 'Child';
  return `${found.firstName || ''} ${found.lastName || ''}`.trim() || 'Child';
}

function parsePagination(query) {
  const rawPage = query?.page;
  const rawLimit = query?.limit;
  const hasPage = rawPage !== undefined;
  const hasLimit = rawLimit !== undefined;
  if (!hasPage && !hasLimit) return null;

  const page = Number(rawPage || 1);
  const limit = Number(rawLimit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
    return { error: 'page and limit must be positive integers' };
  }

  return {
    page,
    limit: Math.min(limit, 100),
    skip: (page - 1) * Math.min(limit, 100),
  };
}

/**
 * GET /api/messaging/conversations
 * Inbox: therapist, parent, or clinician.
 */
exports.listConversations = async (req, res) => {
  try {
    const role = String(req.user?.role ?? req.jwtRole ?? '').toLowerCase();
    const uid = req.user._id;

    let filter;
    if (role === 'therapist') filter = { therapistId: uid };
    else if (role === 'parent') filter = { parentId: uid };
    else if (role === 'clinician') {
      const ownedCases = await ChildCase.find({ clinicianId: uid }).select('_id').lean();
      const caseIds = ownedCases.map((c) => c._id);
      if (caseIds.length === 0) {
        return res.status(200).json({ success: true, data: [] });
      }
      filter = { caseId: { $in: caseIds } };
    }
    else {
      return res.status(403).json({ success: false, message: 'Messaging is available for parents, therapists, and clinicians' });
    }

    const pagination = parsePagination(req.query);
    if (pagination?.error) {
      return res.status(400).json({ success: false, message: pagination.error });
    }

    const findQuery = Conversation.find(filter).sort({ lastMessageAt: -1 });
    if (pagination) {
      findQuery.skip(pagination.skip).limit(pagination.limit);
    }

    const [list, totalCount] = await Promise.all([
      findQuery.lean(),
      pagination ? Conversation.countDocuments(filter) : Promise.resolve(null),
    ]);
    if (list.length === 0) {
      if (!pagination) {
        return res.status(200).json({ success: true, data: [] });
      }
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total: totalCount || 0,
          hasMore: false,
        },
      });
    }

    const caseIds = [...new Set(list.map((c) => String(c.caseId)))];
    const cases = await ChildCase.find({ _id: { $in: caseIds } }).select('_id childId parentId').lean();
    const caseMap = new Map(cases.map((c) => [String(c._id), c]));

    const parentIds = [...new Set(cases.map((c) => String(c.parentId)))];
    const parents = await User.find({ _id: { $in: parentIds } })
      .select('firstName lastName children')
      .lean();
    const parentById = new Map(parents.map((p) => [String(p._id), p]));
    const therapistIds = [...new Set(list.map((c) => String(c.therapistId || '')).filter(Boolean))];
    const therapists = therapistIds.length
      ? await User.find({ _id: { $in: therapistIds } }).select('firstName lastName').lean()
      : [];
    const therapistById = new Map(therapists.map((t) => [String(t._id), `${t.firstName || ''} ${t.lastName || ''}`.trim()]));

    const convIds = list.map((c) => c._id);
    const lastMsgs = await Message.aggregate([
      { $match: { conversationId: { $in: convIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$conversationId',
          text: { $first: '$text' },
          createdAt: { $first: '$createdAt' },
        },
      },
    ]);
    const lastByConv = new Map(lastMsgs.map((m) => [String(m._id), m]));

    const data = list.map((conv) => {
      const c = caseMap.get(String(conv.caseId));
      const parent = c ? parentById.get(String(c.parentId)) : null;
      const childName = c ? childNameFromParent(parent, c.childId) : 'Child';
      const parentName = parent
        ? `${parent.firstName || ''} ${parent.lastName || ''}`.trim() || 'Parent'
        : 'Parent';
      const last = lastByConv.get(String(conv._id));
      return {
        ...conv,
        childName,
        parentName,
        therapistName: therapistById.get(String(conv.therapistId || '')) || 'Therapist',
        preview: last ? String(last.text || '').slice(0, 200) : '',
        previewAt: last?.createdAt || conv.lastMessageAt,
      };
    });

    if (!pagination) {
      return res.status(200).json({ success: true, data });
    }

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: totalCount,
        hasMore: pagination.page * pagination.limit < totalCount,
      },
    });
  } catch (e) {
    console.error('listConversations:', e);
    return res.status(500).json({ success: false, message: 'Failed to load conversations' });
  }
};

/**
 * GET /api/messaging/conversations/:caseId
 * Get or create conversation for a case (parent, therapist, or clinician with access).
 */
exports.getOrCreateConversation = async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: 'Invalid caseId' });
    }

    const role = String(req.user?.role ?? req.jwtRole ?? '').toLowerCase();
    const uid = req.user._id;

    const caseDoc = await ChildCase.findById(caseId).select('_id parentId childId').lean();
    if (!caseDoc) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    if (role === 'parent') {
      if (String(caseDoc.parentId) !== String(uid)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    } else if (role === 'therapist') {
      const access = await assertTherapistCaseAccess(req, caseId, uid);
      if (!access.ok) {
        return res.status(access.status).json({ success: false, message: access.message });
      }
    } else if (role === 'clinician') {
      const clinicianCase = await assertClinicianOwnsCase(uid, caseId);
      if (!clinicianCase) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    } else {
      return res.status(403).json({ success: false, message: 'Permission denied' });
    }

    const therapistId = await resolveTherapistIdForCase(caseId);
    if (!therapistId) {
      return res.status(400).json({
        success: false,
        message: 'No therapist is linked to this case yet. Start therapy or create an assignment first.',
      });
    }

    let conv = await Conversation.findOne({ caseId }).lean();
    if (!conv) {
      const created = await Conversation.create({
        caseId,
        parentId: caseDoc.parentId,
        therapistId,
        lastMessageAt: getCurrentTime(),
      });
      conv = created.toObject();
    } else if (String(conv.therapistId) !== String(therapistId)) {
      await Conversation.updateOne({ _id: conv._id }, { $set: { therapistId } });
      conv = { ...conv, therapistId };
    }

    const parent = await User.findById(caseDoc.parentId).select('firstName lastName children').lean();
    const childName = childNameFromParent(parent, caseDoc.childId);
    const parentName = parent ? `${parent.firstName || ''} ${parent.lastName || ''}`.trim() : 'Parent';
    const therapist = conv.therapistId ? await User.findById(conv.therapistId).select('firstName lastName').lean() : null;
    const therapistName = therapist ? `${therapist.firstName || ''} ${therapist.lastName || ''}`.trim() : 'Therapist';

    return res.status(200).json({
      success: true,
      data: {
        ...conv,
        childName,
        parentName,
        therapistName,
      },
    });
  } catch (e) {
    console.error('getOrCreateConversation:', e);
    return res.status(500).json({ success: false, message: 'Failed to open conversation' });
  }
};

/**
 * GET /api/messaging/messages/:conversationId
 */
exports.listMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversationId' });
    }

    const conv = await Conversation.findById(conversationId).lean();
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const role = String(req.user?.role ?? req.jwtRole ?? '').toLowerCase();
    const uid = req.user._id;
    const isParticipant =
      String(conv.parentId) === String(uid) || String(conv.therapistId) === String(uid);
    let isClinicianOwner = false;
    if (!isParticipant) {
      if (role === 'clinician') {
        const clinicianCase = await assertClinicianOwnsCase(uid, conv.caseId);
        isClinicianOwner = Boolean(clinicianCase);
      }
      if (!isClinicianOwner) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    if (role === 'therapist' && String(conv.therapistId) === String(uid)) {
      const access = await assertTherapistCaseAccess(req, conv.caseId, uid);
      if (!access.ok) {
        return res.status(access.status).json({ success: false, message: access.message });
      }
    }
    if (role === 'parent' && String(conv.parentId) !== String(uid)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const pagination = parsePagination(req.query);
    if (pagination?.error) {
      return res.status(400).json({ success: false, message: pagination.error });
    }

    const findQuery = Message.find({ conversationId: conv._id })
      .populate('senderId', 'firstName lastName role')
      .sort({ createdAt: 1 });
    if (pagination) {
      findQuery.skip(pagination.skip).limit(pagination.limit);
    }

    const [messages, totalCount] = await Promise.all([
      findQuery.lean(),
      pagination ? Message.countDocuments({ conversationId: conv._id }) : Promise.resolve(null),
    ]);

    if (!pagination) {
      return res.status(200).json({ success: true, data: messages });
    }

    return res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: totalCount,
        hasMore: pagination.page * pagination.limit < totalCount,
      },
    });
  } catch (e) {
    console.error('listMessages:', e);
    return res.status(500).json({ success: false, message: 'Failed to load messages' });
  }
};

/**
 * POST /api/messaging/messages
 * Body: { conversationId, text } — sender from JWT.
 */
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, text } = req.body || {};
    const trimmed = String(text || '').trim();
    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'Valid conversationId is required' });
    }
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Message text cannot be empty' });
    }

    const conv = await Conversation.findById(conversationId);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const role = String(req.user?.role ?? req.jwtRole ?? '').toLowerCase();
    const uid = req.user._id;

    const isTherapist = String(conv.therapistId) === String(uid);
    const isParent = String(conv.parentId) === String(uid);
    let isClinicianOwner = false;
    if (!isTherapist && !isParent) {
      if (role === 'clinician') {
        const clinicianCase = await assertClinicianOwnsCase(uid, conv.caseId);
        isClinicianOwner = Boolean(clinicianCase);
      }
      if (!isClinicianOwner) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    if (role === 'therapist' && isTherapist) {
      const access = await assertTherapistCaseAccess(req, conv.caseId, uid);
      if (!access.ok) {
        return res.status(access.status).json({ success: false, message: access.message });
      }
    }
    if (role === 'parent' && !isParent) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const msg = await Message.create({
      conversationId: conv._id,
      senderId: uid,
      text: trimmed,
    });

    conv.lastMessageAt = getCurrentTime();
    await conv.save();

    const caseRow = await ChildCase.findById(conv.caseId).select('clinicianId').lean();
    const senderDoc = await User.findById(uid).select('firstName lastName role').lean();
    const senderLabel = senderDoc
      ? `${senderDoc.firstName || ''} ${senderDoc.lastName || ''}`.trim() || senderDoc.role || 'Care team'
      : 'Care team';

    const recipientIds = new Set(
      [String(conv.parentId), String(conv.therapistId)].filter(Boolean)
    );
    if (caseRow?.clinicianId) recipientIds.add(String(caseRow.clinicianId));
    recipientIds.delete(String(uid));

    const preview = trimmed.length > 180 ? `${trimmed.slice(0, 177)}…` : trimmed;
    await Promise.all(
      [...recipientIds].map((rid) =>
        createNotification({
          recipientId: rid,
          type: NOTIFICATION_TYPES.CASE_MESSAGE,
          title: `New message from ${senderLabel}`,
          message: preview,
          relatedResourceType: 'conversation',
          relatedResourceId: conv._id,
          relatedCaseId: conv.caseId,
        })
      )
    );

    return res.status(201).json({ success: true, data: msg.toObject() });
  } catch (e) {
    console.error('sendMessage:', e);
    return res.status(500).json({ success: false, message: 'Failed to send message' });
  }
};
