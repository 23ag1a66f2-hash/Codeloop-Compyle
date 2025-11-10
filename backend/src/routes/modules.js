const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { requireAuth, requirePermission, requireOwnership } = require('../middleware/auth');
const { Module, User, Department, Group, Question, Note, Assessment } = require('../models');

const router = express.Router();

// All module routes require authentication
router.use(requireAuth);

// Validation rules
const createModuleValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Module title is required')
    .isLength({ max: 200 })
    .withMessage('Module title cannot exceed 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  body('department')
    .isMongoId()
    .withMessage('Invalid department ID'),
  body('groups')
    .optional()
    .isArray()
    .withMessage('Groups must be an array'),
  body('groups.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid group ID'),
  body('difficulty')
    .optional()
    .isIn(['beginner', 'intermediate', 'advanced'])
    .withMessage('Invalid difficulty level'),
  body('estimatedHours')
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage('Estimated hours must be between 1 and 200'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Each tag cannot exceed 50 characters'),
  body('prerequisites')
    .optional()
    .isArray()
    .withMessage('Prerequisites must be an array'),
  body('prerequisites.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid prerequisite module ID'),
  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Sort order must be a non-negative integer')
];

const updateModuleValidation = [
  body('title')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Module title cannot be empty')
    .isLength({ max: 200 })
    .withMessage('Module title cannot exceed 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  body('groups')
    .optional()
    .isArray()
    .withMessage('Groups must be an array'),
  body('groups.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid group ID'),
  body('difficulty')
    .optional()
    .isIn(['beginner', 'intermediate', 'advanced'])
    .withMessage('Invalid difficulty level'),
  body('estimatedHours')
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage('Estimated hours must be between 1 and 200'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Each tag cannot exceed 50 characters'),
  body('prerequisites')
    .optional()
    .isArray()
    .withMessage('Prerequisites must be an array'),
  body('prerequisites.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid prerequisite module ID'),
  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Sort order must be a non-negative integer')
];

const idValidation = [
  param('id').isMongoId().withMessage('Invalid module ID')
];

const bulkIdValidation = [
  body('questionIds').isArray().withMessage('Question IDs must be an array'),
  body('questionIds.*').isMongoId().withMessage('Invalid question ID')
];

// GET /api/modules - List modules with role-based filtering
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const {
      page = 1,
      limit = 10,
      search,
      department,
      group,
      difficulty,
      createdBy,
      tags,
      isActive,
      hasQuestions
    } = req.query;

    // Build query based on user role and filters
    let query = {};

    // Filter by active status if specified
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    } else {
      query.isActive = true; // Default to active modules only
    }

    // Apply search filter if provided
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Apply department filter
    if (department) {
      query.department = department;
    }

    // Apply difficulty filter
    if (difficulty) {
      query.difficulty = difficulty;
    }

    // Apply creator filter
    if (createdBy) {
      query.createdBy = createdBy;
    }

    // Apply tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      query.tags = { $in: tagArray };
    }

    // Filter modules with questions if requested
    if (hasQuestions === 'true') {
      query.questions = { $exists: true, $ne: [] };
    }

    // Role-based access control
    if (user.role.name === 'Admin') {
      // Admin can see all modules
    } else if (user.role.name === 'HOD') {
      // HOD can see modules in their department
      query.department = user.department;
    } else if (user.role.name === 'Teacher') {
      // Teacher can see modules they created or assigned to their groups
      query.$or = [
        { createdBy: user._id },
        { groups: { $in: user.groups } }
      ];
    } else {
      // Student can see modules assigned to their groups
      query.groups = { $in: user.groups };
    }

    // Apply group filter for admin/hod/teacher
    if (group && ['Admin', 'HOD', 'Teacher'].includes(user.role.name)) {
      query.groups = group;
    }

    const modules = await Module.find(query)
      .populate('department', 'name code')
      .populate('createdBy', 'fullName email')
      .populate('groups', 'name code')
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Module.countDocuments(query);

    // Get detailed information for each module
    const modulesWithDetails = await Promise.all(
      modules.map(async (module) => {
        const questionCount = await Question.countDocuments({
          _id: { $in: module.questions },
          isActive: true
        });
        const noteCount = await Note.countDocuments({
          _id: { $in: module.notes },
          isActive: true
        });
        const assessmentCount = await Assessment.countDocuments({
          modules: module._id,
          isActive: true
        });

        return {
          ...module.toObject(),
          questionCount,
          noteCount,
          assessmentCount
        };
      })
    );

    res.json({
      success: true,
      data: modulesWithDetails,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get modules error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch modules'
    });
  }
});

// GET /api/modules/:id - Get module details
router.get('/:id', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;

    let module;
    let accessCheck = false;

    // Check access based on user role
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
      accessCheck = true;
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
      accessCheck = true;
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({
        _id: id,
        $or: [
          { createdBy: user._id },
          { groups: { $in: user.groups } }
        ]
      });
      accessCheck = true;
    } else {
      // Student - check if module is assigned to their groups
      module = await Module.findOne({
        _id: id,
        groups: { $in: user.groups }
      });
      accessCheck = true;
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    // Get full module details
    const moduleDetails = await Module.getWithDetails(id);

    // Get additional statistics
    const questionCount = await Question.countDocuments({
      _id: { $in: module.questions },
      isActive: true
    });
    const noteCount = await Note.countDocuments({
      _id: { $in: module.notes },
      isActive: true
    });
    const assessmentCount = await Assessment.countDocuments({
      modules: module._id,
      isActive: true
    });

    // Get completion statistics for students
    const studentProgress = await getStudentProgressForModule(module._id);

    res.json({
      success: true,
      data: {
        ...moduleDetails.toObject(),
        questionCount,
        noteCount,
        assessmentCount,
        studentProgress
      }
    });
  } catch (error) {
    console.error('Get module error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch module details'
    });
  }
});

// POST /api/modules - Create new module
router.post('/', requirePermission('manage_modules'), createModuleValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      title,
      description,
      department,
      groups = [],
      difficulty = 'beginner',
      estimatedHours,
      tags = [],
      prerequisites = [],
      sortOrder = 0
    } = req.body;

    // Validate department
    const departmentDoc = await Department.findById(department);
    if (!departmentDoc || !departmentDoc.isActive) {
      return res.status(400).json({
        success: false,
        error: 'Department not found or inactive'
      });
    }

    // Check access to department (for non-admin users)
    const user = await User.findById(req.user.id).populate('role');
    if (user.role.name === 'HOD' && !departmentDoc._id.equals(user.department)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot create module in another department'
      });
    }

    // Validate groups if provided
    if (groups.length > 0) {
      const validGroups = await Group.find({
        _id: { $in: groups },
        department: department,
        isActive: true
      });

      if (validGroups.length !== groups.length) {
        return res.status(400).json({
          success: false,
          error: 'Some groups are invalid or belong to different department'
        });
      }

      // Check teacher access to groups
      if (user.role.name === 'Teacher') {
        const teacherGroups = validGroups.filter(group =>
          group.teacher.toString() === user._id.toString()
        );

        if (teacherGroups.length !== validGroups.length) {
          return res.status(403).json({
            success: false,
            error: 'Can only assign modules to groups you teach'
          });
        }
      }
    }

    // Validate prerequisites
    if (prerequisites.length > 0) {
      const validPrerequisites = await Module.find({
        _id: { $in: prerequisites },
        department: department,
        isActive: true
      });

      if (validPrerequisites.length !== prerequisites.length) {
        return res.status(400).json({
          success: false,
          error: 'Some prerequisite modules are invalid or belong to different department'
        });
      }

      // Check for circular dependencies
      const hasCircularDependency = await checkCircularDependency(department, prerequisites);
      if (hasCircularDependency) {
        return res.status(400).json({
          success: false,
          error: 'Circular dependency detected in prerequisites'
        });
      }
    }

    const module = new Module({
      title: title.trim(),
      description: description?.trim(),
      department,
      groups,
      createdBy: user._id,
      difficulty,
      estimatedHours,
      tags: tags.map(tag => tag.trim().toLowerCase()),
      prerequisites,
      sortOrder
    });

    await module.save();

    const populatedModule = await Module.findById(module._id)
      .populate('department', 'name code')
      .populate('createdBy', 'fullName email')
      .populate('groups', 'name code')
      .populate('prerequisites', 'title');

    res.status(201).json({
      success: true,
      message: 'Module created successfully',
      data: populatedModule
    });
  } catch (error) {
    console.error('Create module error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create module'
    });
  }
});

// PUT /api/modules/:id - Update module
router.put('/:id', idValidation, updateModuleValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;
    const updateData = {};

    // Build update data from request body
    const allowedFields = [
      'title', 'description', 'groups', 'difficulty', 'estimatedHours',
      'tags', 'prerequisites', 'sortOrder'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'title' || field === 'description') {
          updateData[field] = req.body[field].trim();
        } else if (field === 'tags') {
          updateData[field] = req.body[field].map(tag => tag.trim().toLowerCase());
        } else {
          updateData[field] = req.body[field];
        }
      }
    });

    // Find module and check access
    let module;
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({
        _id: id,
        createdBy: user._id
      });
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    // Validate groups if being updated
    if (updateData.groups) {
      const validGroups = await Group.find({
        _id: { $in: updateData.groups },
        department: module.department,
        isActive: true
      });

      if (validGroups.length !== updateData.groups.length) {
        return res.status(400).json({
          success: false,
          error: 'Some groups are invalid or belong to different department'
        });
      }

      // Check teacher access to groups
      if (user.role.name === 'Teacher') {
        const teacherGroups = validGroups.filter(group =>
          group.teacher.toString() === user._id.toString()
        );

        if (teacherGroups.length !== validGroups.length) {
          return res.status(403).json({
            success: false,
            error: 'Can only assign modules to groups you teach'
          });
        }
      }
    }

    // Validate prerequisites if being updated
    if (updateData.prerequisites) {
      const validPrerequisites = await Module.find({
        _id: { $in: updateData.prerequisites },
        department: module.department,
        isActive: true,
        _id: { $ne: id } // Exclude self
      });

      if (validPrerequisites.length !== updateData.prerequisites.length) {
        return res.status(400).json({
          success: false,
          error: 'Some prerequisite modules are invalid or belong to different department'
        });
      }

      // Check for circular dependencies
      const hasCircularDependency = await checkCircularDependency(
        module.department,
        [...updateData.prerequisites, id]
      );
      if (hasCircularDependency) {
        return res.status(400).json({
          success: false,
          error: 'Circular dependency detected in prerequisites'
        });
      }
    }

    const updatedModule = await Module.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('department', 'name code')
     .populate('createdBy', 'fullName email')
     .populate('groups', 'name code')
     .populate('prerequisites', 'title');

    res.json({
      success: true,
      message: 'Module updated successfully',
      data: updatedModule
    });
  } catch (error) {
    console.error('Update module error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update module'
    });
  }
});

// DELETE /api/modules/:id - Soft delete module
router.delete('/:id', requirePermission('manage_modules'), idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;

    // Find module and check access
    let module;
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({ _id: id, createdBy: user._id });
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    // Check if module is used in active assessments
    const activeAssessments = await Assessment.countDocuments({
      modules: id,
      isActive: true
    });

    if (activeAssessments > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete module used in active assessments'
      });
    }

    // Check if module is a prerequisite for other active modules
    const dependentModules = await Module.countDocuments({
      prerequisites: id,
      isActive: true
    });

    if (dependentModules > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete module that is a prerequisite for other modules'
      });
    }

    // Soft delete by setting isActive to false
    module.isActive = false;
    await module.save();

    res.json({
      success: true,
      message: 'Module deleted successfully'
    });
  } catch (error) {
    console.error('Delete module error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete module'
    });
  }
});

// POST /api/modules/:id/questions - Add questions to module
router.post('/:id/questions', idValidation, bulkIdValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;
    const { questionIds } = req.body;

    // Find module and check access
    let module;
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({ _id: id, createdBy: user._id });
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    // Validate all questions
    const questions = await Question.find({
      _id: { $in: questionIds },
      isActive: true
    });

    if (questions.length !== questionIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Some questions are not valid or inactive'
      });
    }

    // Check if questions belong to the same department
    const invalidQuestions = questions.filter(question =>
      !question.department || !question.department.equals(module.department)
    );

    if (invalidQuestions.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'All questions must belong to the same department as the module'
      });
    }

    // Filter out questions already in the module
    const questionsToAdd = questionIds.filter(id => !module.questions.includes(id));

    if (questionsToAdd.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'All specified questions are already in the module'
      });
    }

    // Add questions to module
    module.questions.push(...questionsToAdd);
    await module.save();

    const updatedModule = await Module.findById(id)
      .populate({
        path: 'questions',
        match: { isActive: true },
        populate: {
          path: 'createdBy',
          select: 'fullName'
        }
      });

    res.json({
      success: true,
      message: `Successfully added ${questionsToAdd.length} questions to module`,
      data: updatedModule.questions
    });
  } catch (error) {
    console.error('Add questions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add questions to module'
    });
  }
});

// DELETE /api/modules/:id/questions/:questionId - Remove question from module
router.delete('/:id/questions/:questionId', idValidation, [
  param('questionId').isMongoId().withMessage('Invalid question ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id, questionId } = req.params;

    // Find module and check access
    let module;
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({ _id: id, createdBy: user._id });
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    // Check if question is in the module
    if (!module.questions.includes(questionId)) {
      return res.status(400).json({
        success: false,
        error: 'Question is not in this module'
      });
    }

    // Remove question from module
    module.questions = module.questions.filter(qId => !qId.equals(questionId));
    await module.save();

    res.json({
      success: true,
      message: 'Question removed from module successfully'
    });
  } catch (error) {
    console.error('Remove question error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove question from module'
    });
  }
});

// POST /api/modules/:id/notes - Add notes to module
router.post('/:id/notes', idValidation, [
  body('noteIds').isArray().withMessage('Note IDs must be an array'),
  body('noteIds.*').isMongoId().withMessage('Invalid note ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;
    const { noteIds } = req.body;

    // Find module and check access
    let module;
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({ _id: id, createdBy: user._id });
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    // Validate all notes
    const notes = await Note.find({
      _id: { $in: noteIds },
      isActive: true
    });

    if (notes.length !== noteIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Some notes are not valid or inactive'
      });
    }

    // Check if notes belong to the same department
    const invalidNotes = notes.filter(note =>
      !note.department || !note.department.equals(module.department)
    );

    if (invalidNotes.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'All notes must belong to the same department as the module'
      });
    }

    // Filter out notes already in the module
    const notesToAdd = noteIds.filter(id => !module.notes.includes(id));

    if (notesToAdd.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'All specified notes are already in the module'
      });
    }

    // Add notes to module
    module.notes.push(...notesToAdd);
    await module.save();

    const updatedModule = await Module.findById(id)
      .populate({
        path: 'notes',
        match: { isActive: true },
        populate: {
          path: 'uploadedBy',
          select: 'fullName'
        }
      });

    res.json({
      success: true,
      message: `Successfully added ${notesToAdd.length} notes to module`,
      data: updatedModule.notes
    });
  } catch (error) {
    console.error('Add notes error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add notes to module'
    });
  }
});

// DELETE /api/modules/:id/notes/:noteId - Remove note from module
router.delete('/:id/notes/:noteId', idValidation, [
  param('noteId').isMongoId().withMessage('Invalid note ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id, noteId } = req.params;

    // Find module and check access
    let module;
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({ _id: id, createdBy: user._id });
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    // Check if note is in the module
    if (!module.notes.includes(noteId)) {
      return res.status(400).json({
        success: false,
        error: 'Note is not in this module'
      });
    }

    // Remove note from module
    module.notes = module.notes.filter(nId => !nId.equals(noteId));
    await module.save();

    res.json({
      success: true,
      message: 'Note removed from module successfully'
    });
  } catch (error) {
    console.error('Remove note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove note from module'
    });
  }
});

// GET /api/modules/:id/progress - Get module progress for students
router.get('/:id/progress', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;

    // Check access to module
    let module;
    if (user.role.name === 'Admin') {
      module = await Module.findById(id);
    } else if (user.role.name === 'HOD') {
      module = await Module.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      module = await Module.findOne({
        _id: id,
        $or: [
          { createdBy: user._id },
          { groups: { $in: user.groups } }
        ]
      });
    } else {
      // Student - check if module is assigned to their groups
      module = await Module.findOne({
        _id: id,
        groups: { $in: user.groups }
      });
    }

    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found or access denied'
      });
    }

    const progressData = await getStudentProgressForModule(module._id);

    res.json({
      success: true,
      data: progressData
    });
  } catch (error) {
    console.error('Get module progress error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch module progress'
    });
  }
});

// Helper functions
async function getStudentProgressForModule(moduleId) {
  const PerformanceMetric = require('../models/PerformanceMetric');

  // Get all students assigned to this module's groups
  const module = await Module.findById(moduleId).populate({
    path: 'groups',
    populate: {
      path: 'students',
      select: 'fullName email'
    }
  });

  const allStudents = module.groups.flatMap(group => group.students);
  const uniqueStudents = [...new Map(allStudents.map(student => [student._id.toString(), student])).values()];

  // Get progress metrics for these students
  const studentProgress = await Promise.all(
    uniqueStudents.map(async (student) => {
      const metrics = await PerformanceMetric.find({
        student: student._id,
        module: moduleId
      });

      const totalQuestions = await Question.countDocuments({
        _id: { $in: module.questions },
        isActive: true
      });

      const completedQuestions = metrics.reduce((sum, metric) =>
        sum + (metric.acceptedSubmissions || 0), 0
      );

      const completionPercentage = totalQuestions > 0 ? (completedQuestions / totalQuestions) * 100 : 0;

      return {
        student,
        completedQuestions,
        totalQuestions,
        completionPercentage,
        averageScore: metrics.reduce((sum, metric) =>
          sum + (metric.averageAssessmentScore || 0), 0
        ) / (metrics.length || 1),
        lastActivity: metrics.length > 0 ?
          Math.max(...metrics.map(m => m.updatedAt)) : null
      };
    })
  );

  const overview = {
    totalStudents: uniqueStudents.length,
    averageCompletion: studentProgress.reduce((sum, s) => sum + s.completionPercentage, 0) / (studentProgress.length || 1),
    completedStudents: studentProgress.filter(s => s.completionPercentage === 100).length,
    inProgressStudents: studentProgress.filter(s => s.completionPercentage > 0 && s.completionPercentage < 100).length,
    notStartedStudents: studentProgress.filter(s => s.completionPercentage === 0).length
  };

  return {
    overview,
    studentProgress: studentProgress.sort((a, b) => b.completionPercentage - a.completionPercentage)
  };
}

async function checkCircularDependency(departmentId, moduleIds) {
  const visited = new Set();
  const recursionStack = new Set();

  function hasCycle(currentModuleId) {
    if (recursionStack.has(currentModuleId)) {
      return true;
    }
    if (visited.has(currentModuleId)) {
      return false;
    }

    visited.add(currentModuleId);
    recursionStack.add(currentModuleId);

    const currentModule = modules.find(m => m._id.toString() === currentModuleId.toString());
    if (currentModule && currentModule.prerequisites) {
      for (const prereqId of currentModule.prerequisites) {
        if (hasCycle(prereqId.toString())) {
          return true;
        }
      }
    }

    recursionStack.delete(currentModuleId);
    return false;
  }

  const modules = await Module.find({
    _id: { $in: moduleIds },
    department: departmentId
  }).select('prerequisites');

  for (const moduleId of moduleIds) {
    if (hasCycle(moduleId.toString())) {
      return true;
    }
  }

  return false;
}

module.exports = router;