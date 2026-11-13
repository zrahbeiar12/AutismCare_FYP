const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const {
  normalizeActivityInput,
  templateBaseQuery,
  applyDomainFilter,
  applySearchFilter,
  hasActivityBodyContent,
  activityAccessFilter,
  ACTIVITY_DOMAIN_OPTIONS,
  DIFFICULTY_OPTIONS,
} = require('../utils/activityShared');

/**
 * GET /api/activities/templates?domain=Speech&search=
 */
exports.listTemplates = async (req, res) => {
  try {
    const therapistId = req.user._id;
    const { domain, search } = req.query || {};
    const q = { ...templateBaseQuery(therapistId) };
    applyDomainFilter(q, domain);
    applySearchFilter(q, search);

    /**
     * Include fields needed for the Activity Library grid (objective, procedure, difficulty).
     * Still `.select()` explicit paths to avoid oversized lean docs if the schema grows.
     */
    const list = await Activity.find(q)
      .select(
        '_id name domain materials difficulty frequency objective procedure instructions notes parentInvolvement isTemplate createdBy'
      )
      .sort({ domain: 1, name: 1 })
      .lean();
    const data = list.map((row) => ({
      _id: row._id,
      name: row.name,
      domain: row.domain,
      materials: row.materials,
      difficulty: row.difficulty,
      frequency: row.frequency,
      objective: row.objective,
      procedure: row.procedure,
      instructions: row.instructions,
      notes: row.notes,
      parentInvolvement: row.parentInvolvement,
      createdBy: row.createdBy || null,
      isPlatformTemplate: row.createdBy == null,
    }));
    return res.status(200).json({
      success: true,
      data,
      meta: {
        domainOptions: ACTIVITY_DOMAIN_OPTIONS,
        filterDomainOptions: ['Speech', 'OT', 'Sensory', 'Behavioral', 'AAC', 'PECS'],
        difficultyOptions: DIFFICULTY_OPTIONS,
      },
    });
  } catch (error) {
    console.error('listTemplates:', error);
    return res.status(500).json({ success: false, message: 'Failed to list templates' });
  }
};

/**
 * POST /api/activities/templates
 */
exports.createTemplate = async (req, res) => {
  try {
    const therapistId = req.user._id;
    const n = normalizeActivityInput({ ...req.body, isTemplate: true });
    if (!n.name) {
      return res.status(400).json({ success: false, message: 'Activity name is required' });
    }
    if (!n.domain) {
      return res.status(400).json({ success: false, message: 'Valid domain is required' });
    }
    if (!hasActivityBodyContent(n)) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of: instructions, objective, or procedure',
      });
    }

    const dup = await Activity.findOne({ createdBy: therapistId, name: n.name }).lean();
    if (dup) {
      return res.status(409).json({ success: false, message: 'An activity with this name already exists' });
    }

    const created = await Activity.create({
      ...n,
      isTemplate: true,
      createdBy: therapistId,
    });
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'An activity with this name already exists' });
    }
    console.error('createTemplate:', error);
    return res.status(500).json({ success: false, message: 'Failed to create template' });
  }
};

/**
 * PATCH /api/activities/templates/:id
 */
exports.updateTemplate = async (req, res) => {
  try {
    const therapistId = req.user._id;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid template id' });
    }

    const doc = await Activity.findOne({
      _id: id,
      $or: [{ isTemplate: true }, { isTemplate: { $exists: false } }],
    });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    if (doc.createdBy == null) {
      return res.status(403).json({
        success: false,
        message: 'Platform templates cannot be edited. Clone to create your own copy.',
      });
    }
    if (String(doc.createdBy) !== String(therapistId)) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const n = normalizeActivityInput({ ...doc.toObject(), ...req.body, isTemplate: true });
    if (!n.name) {
      return res.status(400).json({ success: false, message: 'Activity name is required' });
    }
    if (!n.domain) {
      return res.status(400).json({ success: false, message: 'Valid domain is required' });
    }
    if (!hasActivityBodyContent(n)) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of: instructions, objective, or procedure',
      });
    }

    if (n.name !== doc.name) {
      const dup = await Activity.findOne({ createdBy: therapistId, name: n.name, _id: { $ne: id } }).lean();
      if (dup) {
        return res.status(409).json({ success: false, message: 'An activity with this name already exists' });
      }
    }

    Object.assign(doc, {
      name: n.name,
      objective: n.objective,
      procedure: n.procedure,
      notes: n.notes,
      instructions: n.instructions,
      materials: n.materials,
      frequency: n.frequency,
      difficulty: n.difficulty,
      parentInvolvement: n.parentInvolvement,
      domain: n.domain,
      isTemplate: true,
    });
    await doc.save();

    return res.status(200).json({ success: true, data: doc.toObject() });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'An activity with this name already exists' });
    }
    console.error('updateTemplate:', error);
    return res.status(500).json({ success: false, message: 'Failed to update template' });
  }
};

/**
 * POST /api/activities/templates/:id/clone
 */
exports.cloneTemplate = async (req, res) => {
  try {
    const therapistId = req.user._id;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid template id' });
    }

    const src = await Activity.findOne({
      _id: id,
      $and: [
        activityAccessFilter(therapistId),
        { $or: [{ isTemplate: true }, { isTemplate: { $exists: false } }] },
      ],
    }).lean();
    if (!src) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    let baseName = `${src.name} (copy)`;
    let suffix = 2;
    while (await Activity.findOne({ createdBy: therapistId, name: baseName }).lean()) {
      baseName = `${src.name} (copy ${suffix})`;
      suffix += 1;
    }

    const created = await Activity.create({
      name: baseName,
      objective: src.objective || '',
      procedure: src.procedure || '',
      notes: src.notes || '',
      instructions: src.instructions || '',
      materials: src.materials || '',
      frequency: src.frequency || '',
      difficulty: src.difficulty || 'Medium',
      parentInvolvement: Boolean(src.parentInvolvement),
      domain: src.domain,
      isTemplate: true,
      createdBy: therapistId,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('cloneTemplate:', error);
    return res.status(500).json({ success: false, message: 'Failed to clone template' });
  }
};
