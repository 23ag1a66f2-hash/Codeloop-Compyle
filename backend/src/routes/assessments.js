const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { requireAuth, requirePermission, requireOwnership } = require('../middleware/auth');
const { Assessment, User, Department, Group, Question, AssessmentSubmission } = require('../models');

const router = express.Router();

// All assessment routes require authentication
router.use(requireAuth);

// Validation rules
const createAssessmentValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Assessment title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  body('department')
    .isMongoId()
    .withMessage('Invalid department ID'),
  body('groups')
    .isArray({ min: 1 })
    .withMessage('At least one group must be selected'),
  body('groups.*')
    .isMongoId()
    .withMessage('Invalid group ID'),
  body('startTime')
    .isISO8601()
    .withMessage('Start time must be a valid date')
    .custom(value => {
      const startTime = new Date(value);
      const now = new Date();
      if (startTime <= now) {
        throw new Error('Start time must be in the future');
      }
      return true;
    }),
  body('duration')
    .isInt({ min: 5, max: 480 })
    .withMessage('Duration must be between 5 and 480 minutes'),
  body('codingQuestions')
    .optional()
    .isArray()
    .withMessage('Coding questions must be an array'),
  body('codingQuestions.*.question')
    .optional()
    .isMongoId()
    .withMessage('Invalid question ID'),
  body('codingQuestions.*.points')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Points must be between 1 and 100'),
  body('codingQuestions.*.maxAttempts')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Max attempts must be between 1 and 10'),
  body('mcqQuestions')
    .optional()
    .isArray()
    .withMessage('MCQ questions must be an array'),
  body('mcqQuestions.*.question')
    .optional()
    .isMongoId()
    .withMessage('Invalid question ID'),
  body('mcqQuestions.*.points')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Points must be between 1 and 100'),
  body('mcqQuestions.*.maxAttempts')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Max attempts must be between 1 and 10'),
  body('shuffleQuestions')
    .optional()
    .isBoolean()
    .withMessage('Shuffle questions must be boolean'),
  body('shuffleOptions')
    .optional()
    .isBoolean()
    .withMessage('Shuffle options must be boolean'),
  body('showResultsImmediately')
    .optional()
    .isBoolean()
    .withMessage('Show results immediately must be boolean'),
  body('allowLateSubmission')
    .optional()
    .isBoolean()
    .withMessage('Allow late submission must be boolean'),
  body('showCorrectAnswers')
    .optional()
    .isBoolean()
    .withMessage('Show correct answers must be boolean'),
  body('preventTabSwitch')
    .optional()
    .isBoolean()
    .withMessage('Prevent tab switch must be boolean'),
  body('passingScore')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Passing score must be between 0 and 100'),
  body('negativeMarking')
    .optional()
    .isBoolean()
    .withMessage('Negative marking must be boolean'),
  body('negativeMarkingValue')
    .optional()
    .isFloat({ min: 0, max: 1 })
    .withMessage('Negative marking value must be between 0 and 1'),
  body('instructions')
    .optional()
    .trim()
];

const updateAssessmentValidation = [
  body('title')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Title cannot be empty')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  body('groups')
    .optional()
    .isArray()
    .withMessage('Groups must be an array'),
  body('startTime')
    .optional()
    .isISO8601()
    .withMessage('Start time must be a valid date'),
  body('duration')
    .optional()
    .isInt({ min: 5, max: 480 })
    .withMessage('Duration must be between 5 and 480 minutes')
];

const idValidation = [
  param('id').isMongoId().withMessage('Invalid assessment ID')
];

const submissionValidation = [
  body('questionId').isMongoId().withMessage('Invalid question ID'),
  body('answer').notEmpty().withMessage('Answer is required'),
  body('language')
    .optional()
    .isIn(['python', 'java', 'c', 'cpp', 'javascript'])
    .withMessage('Invalid programming language')
];

// GET /api/assessments - List assessments with role-based filtering
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const {
      page = 1,
      limit = 10,
      search,
      department,
      status,
      isPublished,
      startDate,
      endDate,
      createdBy
    } = req.query;

    // Build query based on user role
    let query = { isActive: true };

    // Apply search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Apply department filter
    if (department) {
      query.department = department;
    }

    // Apply status filter
    if (status) {
      query.status = status;
    }

    // Apply published filter
    if (isPublished !== undefined) {
      query.isPublished = isPublished === 'true';
    }

    // Apply date range filter
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    // Apply creator filter
    if (createdBy) {
      query.createdBy = createdBy;
    }

    // Role-based access control
    if (user.role.name === 'Admin') {
      // Admin can see all assessments
    } else if (user.role.name === 'HOD') {
      // HOD can see assessments in their department
      query.department = user.department;
    } else if (user.role.name === 'Teacher') {
      // Teacher can see assessments they created or for their groups
      query.$or = [
        { createdBy: user._id },
        { groups: { $in: user.groups } }
      ];
    } else {
      // Student can see published assessments for their groups
      query.isPublished = true;
      query.groups = { $in: user.groups };
    }

    const assessments = await Assessment.find(query)
      .populate('department', 'name code')
      .populate('createdBy', 'fullName email')
      .populate('groups', 'name code')
      .sort({ startTime: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Assessment.countDocuments(query);

    // Get additional statistics for each assessment
    const assessmentsWithStats = await Promise.all(
      assessments.map(async (assessment) => {
        const assessmentObj = assessment.toObject();
        assessmentObj.totalQuestions = assessment.totalQuestions;
        assessmentObj.totalPoints = assessment.totalPoints;
        assessmentObj.codingPoints = assessment.codingPoints;
        assessmentObj.mcqPoints = assessment.mcqPoints;
        assessmentObj.currentStatus = assessment.getStatus();

        // Get submission count
        const submissionCount = await AssessmentSubmission.countDocuments({
          assessment: assessment._id
        });

        assessmentObj.submissionCount = submissionCount;

        return assessmentObj;
      })
    );

    res.json({
      success: true,
      data: assessmentsWithStats,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get assessments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessments'
    });
  }
});

// GET /api/assessments/active - Get currently active assessments
router.get('/active', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const { groupId } = req.query;

    // Students can only see active assessments for their groups
    if (user.role.name === 'Student') {
      const activeAssessments = await Assessment.getActiveAssessments(
        groupId && user.groups.includes(groupId) ? groupId : null
      );

      const filteredAssessments = activeAssessments.filter(assessment =>
        assessment.groups.some(group => user.groups.includes(group._id))
      );

      const assessmentsWithDetails = await Promise.all(
        filteredAssessments.map(async (assessment) => {
          const assessmentObj = assessment.toObject();
          assessmentObj.totalQuestions = assessment.totalQuestions;
          assessmentObj.totalPoints = assessment.totalPoints;
          assessmentObj.currentStatus = assessment.getStatus();

          // Check if user has already submitted
          const existingSubmission = await AssessmentSubmission.findOne({
            assessment: assessment._id,
            student: user._id
          });

          assessmentObj.hasSubmitted = !!existingSubmission;
          assessmentObj.canRetake = !existingSubmission || assessment.allowLateSubmission;

          return assessmentObj;
        })
      );

      return res.json({
        success: true,
        data: assessmentsWithDetails
      });
    }

    // Teachers and admins can see all active assessments
    const activeAssessments = await Assessment.getActiveAssessments();

    const assessmentsWithDetails = await Promise.all(
      activeAssessments.map(async (assessment) => {
        const assessmentObj = assessment.toObject();
        assessmentObj.totalQuestions = assessment.totalQuestions;
        assessmentObj.totalPoints = assessment.totalPoints;
        assessmentObj.currentStatus = assessment.getStatus();

        const submissionCount = await AssessmentSubmission.countDocuments({
          assessment: assessment._id
        });

        assessmentObj.submissionCount = submissionCount;

        return assessmentObj;
      })
    );

    res.json({
      success: true,
      data: assessmentsWithDetails
    });
  } catch (error) {
    console.error('Get active assessments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active assessments'
    });
  }
});

// GET /api/assessments/:id - Get assessment details
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

    let assessment;
    let accessCheck = false;

    // Check access based on user role
    if (user.role.name === 'Admin') {
      assessment = await Assessment.findById(id);
      accessCheck = true;
    } else if (user.role.name === 'HOD') {
      assessment = await Assessment.findOne({ _id: id, department: user.department });
      accessCheck = true;
    } else if (user.role.name === 'Teacher') {
      assessment = await Assessment.findOne({
        _id: id,
        $or: [
          { createdBy: user._id },
          { groups: { $in: user.groups } }
        ]
      });
      accessCheck = true;
    } else {
      // Student - check if assessment is published and assigned to their groups
      assessment = await Assessment.findOne({
        _id: id,
        isPublished: true,
        isActive: true,
        groups: { $in: user.groups }
      });
      accessCheck = true;
    }

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found or access denied'
      });
    }

    // Get full assessment details
    const assessmentDetails = await Assessment.getWithDetails(id);

    // For students, hide question details if assessment hasn't started
    if (user.role.name === 'Student') {
      const now = new Date();
      if (now < assessment.startTime) {
        // Hide questions and answers before assessment starts
        assessmentDetails.codingQuestions = assessmentDetails.codingQuestions.map(q => ({
          points: q.points,
          maxAttempts: q.maxAttempts,
          order: q.order
        }));
        assessmentDetails.mcqQuestions = assessmentDetails.mcqQuestions.map(q => ({
          points: q.points,
          maxAttempts: q.maxAttempts,
          order: q.order
        }));
      }

      // Check if student has already submitted
      const existingSubmission = await AssessmentSubmission.findOne({
        assessment: id,
        student: user._id
      });

      assessmentDetails.hasSubmitted = !!existingSubmission;
      assessmentDetails.canRetake = !existingSubmission || assessment.allowLateSubmission;
    }

    // Add statistics
    const assessmentObj = assessmentDetails.toObject();
    assessmentObj.totalQuestions = assessment.totalQuestions;
    assessmentObj.totalPoints = assessment.totalPoints;
    assessmentObj.codingPoints = assessment.codingPoints;
    assessmentObj.mcqPoints = assessment.mcqPoints;
    assessmentObj.currentStatus = assessment.getStatus();

    res.json({
      success: true,
      data: assessmentObj
    });
  } catch (error) {
    console.error('Get assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessment details'
    });
  }
});

// POST /api/assessments - Create new assessment
router.post('/', requirePermission('manage_assessments'), createAssessmentValidation, async (req, res) => {
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
      groups,
      startTime,
      duration,
      codingQuestions = [],
      mcqQuestions = [],
      shuffleQuestions = false,
      shuffleOptions = false,
      showResultsImmediately = true,
      allowLateSubmission = false,
      showCorrectAnswers = true,
      preventTabSwitch = false,
      passingScore = 40,
      negativeMarking = false,
      negativeMarkingValue = 0.25,
      instructions
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
        error: 'Cannot create assessment in another department'
      });
    }

    // Validate groups
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
          error: 'Can only create assessments for groups you teach'
        });
      }
    }

    // Validate questions
    const allQuestionIds = [
      ...codingQuestions.map(q => q.question),
      ...mcqQuestions.map(q => q.question)
    ];

    if (allQuestionIds.length > 0) {
      const validQuestions = await Question.find({
        _id: { $in: allQuestionIds },
        department: department,
        isActive: true
      });

      if (validQuestions.length !== allQuestionIds.length) {
        return res.status(400).json({
          success: false,
          error: 'Some questions are invalid or belong to different department'
        });
      }

      // Validate question types match arrays
      const codingQuestionIds = codingQuestions.map(q => q.question);
      const mcqQuestionIds = mcqQuestions.map(q => q.question);

      for (const question of validQuestions) {
        if (codingQuestionIds.includes(question._id.toString()) && question.type !== 'coding') {
          return res.status(400).json({
            success: false,
            error: 'Invalid question type in coding questions array'
          });
        }
        if (mcqQuestionIds.includes(question._id.toString()) && question.type !== 'mcq') {
          return res.status(400).json({
            success: false,
            error: 'Invalid question type in MCQ questions array'
          });
        }
      }
    }

    // Calculate end time
    const endTime = new Date(new Date(startTime).getTime() + duration * 60000);

    const assessment = new Assessment({
      title: title.trim(),
      description: description?.trim(),
      department,
      groups,
      createdBy: user._id,
      startTime,
      duration,
      endTime,
      codingQuestions,
      mcqQuestions,
      shuffleQuestions,
      shuffleOptions,
      showResultsImmediately,
      allowLateSubmission,
      showCorrectAnswers,
      preventTabSwitch,
      passingScore,
      negativeMarking,
      negativeMarkingValue,
      instructions: instructions?.trim()
    });

    await assessment.save();

    const populatedAssessment = await Assessment.getWithDetails(assessment._id);

    res.status(201).json({
      success: true,
      message: 'Assessment created successfully',
      data: populatedAssessment
    });
  } catch (error) {
    console.error('Create assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create assessment'
    });
  }
});

// PUT /api/assessments/:id - Update assessment
router.put('/:id', idValidation, updateAssessmentValidation, async (req, res) => {
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

    // Find assessment and check access
    let assessment;
    if (user.role.name === 'Admin') {
      assessment = await Assessment.findById(id);
    } else if (user.role.name === 'HOD') {
      assessment = await Assessment.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      assessment = await Assessment.findOne({ _id: id, createdBy: user._id });
    }

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found or access denied'
      });
    }

    // Check if assessment can be updated (not started)
    if (assessment.getStatus() !== 'draft' && assessment.getStatus() !== 'upcoming') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update assessment that has already started'
      });
    }

    // Update assessment fields
    const updateData = {};
    const allowedFields = [
      'title', 'description', 'groups', 'startTime', 'duration',
      'shuffleQuestions', 'shuffleOptions', 'showResultsImmediately',
      'allowLateSubmission', 'showCorrectAnswers', 'preventTabSwitch',
      'passingScore', 'negativeMarking', 'negativeMarkingValue', 'instructions'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (['title', 'description', 'instructions'].includes(field)) {
          updateData[field] = req.body[field].trim();
        } else {
          updateData[field] = req.body[field];
        }
      }
    });

    // Validate groups if being updated
    if (updateData.groups) {
      const validGroups = await Group.find({
        _id: { $in: updateData.groups },
        department: assessment.department,
        isActive: true
      });

      if (validGroups.length !== updateData.groups.length) {
        return res.status(400).json({
          success: false,
          error: 'Some groups are invalid or belong to different department'
        });
      }
    }

    const updatedAssessment = await Assessment.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('department', 'name code')
     .populate('createdBy', 'fullName email')
     .populate('groups', 'name code');

    res.json({
      success: true,
      message: 'Assessment updated successfully',
      data: updatedAssessment
    });
  } catch (error) {
    console.error('Update assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update assessment'
    });
  }
});

// POST /api/assessments/:id/publish - Publish assessment
router.post('/:id/publish', idValidation, async (req, res) => {
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

    // Find assessment and check access
    let assessment;
    if (user.role.name === 'Admin') {
      assessment = await Assessment.findById(id);
    } else if (user.role.name === 'HOD') {
      assessment = await Assessment.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      assessment = await Assessment.findOne({ _id: id, createdBy: user._id });
    }

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found or access denied'
      });
    }

    // Validate assessment has questions
    if (assessment.totalQuestions === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot publish assessment without questions'
      });
    }

    // Publish assessment
    assessment.isPublished = true;
    assessment.status = 'published';
    await assessment.save();

    res.json({
      success: true,
      message: 'Assessment published successfully',
      data: {
        _id: assessment._id,
        title: assessment.title,
        status: assessment.status,
        isPublished: assessment.isPublished
      }
    });
  } catch (error) {
    console.error('Publish assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to publish assessment'
    });
  }
});

// POST /api/assessments/:id/start - Start assessment session
router.post('/:id/start', idValidation, async (req, res) => {
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

    // Only students can start assessments
    if (user.role.name !== 'Student') {
      return res.status(403).json({
        success: false,
        error: 'Only students can start assessments'
      });
    }

    // Find assessment
    const assessment = await Assessment.getWithDetails(id);

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found'
      });
    }

    // Check if assessment is accessible
    if (!assessment.isAccessible(user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Assessment is not accessible at this time'
      });
    }

    // Check if student is assigned to this assessment
    const isAssigned = assessment.groups.some(group =>
      user.groups.includes(group._id)
    );

    if (!isAssigned) {
      return res.status(403).json({
        success: false,
        error: 'You are not assigned to this assessment'
      });
    }

    // Check if student has already submitted
    const existingSubmission = await AssessmentSubmission.findOne({
      assessment: id,
      student: user._id
    });

    if (existingSubmission && existingSubmission.status === 'submitted') {
      return res.status(400).json({
        success: false,
        error: 'You have already submitted this assessment'
      });
    }

    // Create or get existing submission
    let submission;
    if (existingSubmission) {
      submission = existingSubmission;
    } else {
      submission = new AssessmentSubmission({
        assessment: id,
        student: user._id,
        startedAt: new Date()
      });
      await submission.save();
    }

    // Calculate end time for student
    const now = new Date();
    const studentEndTime = new Date(
      Math.min(
        submission.startedAt.getTime() + assessment.duration * 60000,
        assessment.endTime.getTime()
      )
    );

    // Prepare questions (shuffle if needed)
    let codingQuestions = [...assessment.codingQuestions];
    let mcqQuestions = [...assessment.mcqQuestions];

    if (assessment.shuffleQuestions) {
      // Shuffle questions
      codingQuestions.sort(() => Math.random() - 0.5);
      mcqQuestions.sort(() => Math.random() - 0.5);
    }

    if (assessment.shuffleOptions) {
      // Shuffle MCQ options
      mcqQuestions = mcqQuestions.map(q => {
        const options = q.question.options;
        const correctAnswer = q.question.correctAnswer;
        const shuffledIndices = [...Array(options.length).keys()].sort(() => Math.random() - 0.5);

        return {
          ...q.toObject(),
          question: {
            ...q.question.toObject(),
            options: shuffledIndices.map(i => options[i]),
            originalCorrectAnswer: correctAnswer,
            shuffledCorrectAnswer: shuffledIndices.indexOf(correctAnswer)
          }
        };
      });
    }

    res.json({
      success: true,
      message: 'Assessment session started successfully',
      data: {
        submissionId: submission._id,
        assessment: {
          _id: assessment._id,
          title: assessment.title,
          description: assessment.description,
          duration: assessment.duration,
          instructions: assessment.instructions,
          negativeMarking: assessment.negativeMarking,
          negativeMarkingValue: assessment.negativeMarkingValue,
          preventTabSwitch: assessment.preventTabSwitch
        },
        endTime: studentEndTime,
        timeRemaining: Math.max(0, Math.floor((studentEndTime - now) / 1000)),
        codingQuestions,
        mcqQuestions,
        totalQuestions: assessment.totalQuestions,
        totalPoints: assessment.totalPoints
      }
    });
  } catch (error) {
    console.error('Start assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start assessment'
    });
  }
});

// POST /api/assessments/:id/submit-mcq - Submit MCQ answers
router.post('/:id/submit-mcq', idValidation, submissionValidation, async (req, res) => {
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
    const { questionId, answer } = req.body;

    // Only students can submit answers
    if (user.role.name !== 'Student') {
      return res.status(403).json({
        success: false,
        error: 'Only students can submit answers'
      });
    }

    // Find submission
    const submission = await AssessmentSubmission.findOne({
      assessment: id,
      student: user._id,
      status: 'in_progress'
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'No active assessment session found'
      });
    }

    // Find question
    const question = await Question.findById(questionId);
    if (!question || question.type !== 'mcq') {
      return res.status(400).json({
        success: false,
        error: 'Invalid MCQ question'
      });
    }

    // Update or add MCQ answer
    const existingAnswerIndex = submission.mcqAnswers.findIndex(
      a => a.question.toString() === questionId
    );

    const isCorrect = parseInt(answer) === question.correctAnswer;

    if (existingAnswerIndex >= 0) {
      submission.mcqAnswers[existingAnswerIndex] = {
        question: questionId,
        selectedAnswer: parseInt(answer),
        isCorrect
      };
    } else {
      submission.mcqAnswers.push({
        question: questionId,
        selectedAnswer: parseInt(answer),
        isCorrect
      });
    }

    await submission.save();

    res.json({
      success: true,
      message: 'MCQ answer submitted successfully',
      data: {
        isCorrect,
        questionPoints: submission.mcqAnswers.find(a =>
          a.question.toString() === questionId
        )?.points || 0
      }
    });
  } catch (error) {
    console.error('Submit MCQ answer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit MCQ answer'
    });
  }
});

// POST /api/assessments/:id/submit-coding - Submit coding solution
router.post('/:id/submit-coding', idValidation, [
  body('questionId').isMongoId().withMessage('Invalid question ID'),
  body('code').trim().notEmpty().withMessage('Code is required'),
  body('language').isIn(['python', 'java', 'c', 'cpp', 'javascript']).withMessage('Invalid programming language')
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
    const { questionId, code, language } = req.body;

    // Only students can submit solutions
    if (user.role.name !== 'Student') {
      return res.status(403).json({
        success: false,
        error: 'Only students can submit solutions'
      });
    }

    // Find submission
    const submission = await AssessmentSubmission.findOne({
      assessment: id,
      student: user._id,
      status: 'in_progress'
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'No active assessment session found'
      });
    }

    // Find question
    const question = await Question.findById(questionId);
    if (!question || question.type !== 'coding') {
      return res.status(400).json({
        success: false,
        error: 'Invalid coding question'
      });
    }

    // Check if within attempt limits
    const existingAttempts = submission.codingSubmissions.find(
      s => s.question.toString() === questionId
    );

    const assessment = await Assessment.findById(id);
    const questionConfig = assessment.codingQuestions.find(
      q => q.question.toString() === questionId
    );

    if (existingAttempts && existingAttempts.attempts.length >= questionConfig.maxAttempts) {
      return res.status(400).json({
        success: false,
        error: 'Maximum attempts reached for this question'
      });
    }

    // Queue code execution (placeholder for Judge0 integration)
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add submission attempt
    const newAttempt = {
      code,
      language,
      submittedAt: new Date(),
      executionId,
      testResults: [], // Would be populated after execution
      totalPassed: 0,
      totalTestCases: question.testCases?.length || 0,
      score: 0
    };

    if (existingAttempts) {
      existingAttempts.attempts.push(newAttempt);
      existingAttempts.isCompleted = false;
    } else {
      submission.codingSubmissions.push({
        question: questionId,
        attempts: [newAttempt],
        bestScore: 0,
        isCompleted: false
      });
    }

    await submission.save();

    res.json({
      success: true,
      message: 'Coding solution submitted successfully',
      data: {
        executionId,
        status: 'queued',
        estimatedTime: '3-8 seconds'
      }
    });
  } catch (error) {
    console.error('Submit coding solution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit coding solution'
    });
  }
});

// POST /api/assessments/:id/submit - Submit final assessment
router.post('/:id/submit', idValidation, async (req, res) => {
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

    // Only students can submit assessments
    if (user.role.name !== 'Student') {
      return res.status(403).json({
        success: false,
        error: 'Only students can submit assessments'
      });
    }

    // Find submission
    const submission = await AssessmentSubmission.findOne({
      assessment: id,
      student: user._id,
      status: 'in_progress'
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'No active assessment session found'
      });
    }

    // Get assessment details for scoring
    const assessment = await Assessment.findById(id);

    // Calculate final scores
    const mcqScore = submission.mcqAnswers.reduce((sum, answer) => {
      const questionConfig = assessment.mcqQuestions.find(
        q => q.question.toString() === answer.question.toString()
      );
      const points = answer.isCorrect ? (questionConfig?.points || 5) : 0;
      const negativePoints = assessment.negativeMarking && !answer.isCorrect ?
        (questionConfig?.points || 5) * assessment.negativeMarkingValue : 0;
      return sum + points - negativePoints;
    }, 0);

    const codingScore = submission.codingSubmissions.reduce((sum, submission) => {
      return sum + (submission.bestScore || 0);
    }, 0);

    const totalScore = mcqScore + codingScore;
    const maxScore = assessment.totalPoints;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    // Update submission
    submission.submittedAt = new Date();
    submission.timeTaken = Math.floor((submission.submittedAt - submission.startedAt) / 1000);
    submission.mcqScore = mcqScore;
    submission.codingScore = codingScore;
    submission.totalScore = totalScore;
    submission.status = 'submitted';

    await submission.save();

    // Update performance metrics
    const PerformanceMetric = require('../models/PerformanceMetric');
    await PerformanceMetric.findOneAndUpdate(
      {
        student: user._id,
        assessment: id,
        department: user.department
      },
      {
        $inc: {
          totalAssessments: 1,
          completedAssessments: 1
        },
        $set: {
          averageAssessmentScore: percentage,
          lastAssessmentAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Assessment submitted successfully',
      data: {
        submissionId: submission._id,
        scores: {
          mcq: mcqScore,
          coding: codingScore,
          total: totalScore,
          maxScore,
          percentage
        },
        timeTaken: submission.timeTaken,
        passed: percentage >= assessment.passingScore
      }
    });
  } catch (error) {
    console.error('Submit assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit assessment'
    });
  }
});

// GET /api/assessments/:id/results - Get assessment results
router.get('/:id/results', idValidation, async (req, res) => {
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

    // Find assessment
    let assessment;
    if (user.role.name === 'Admin') {
      assessment = await Assessment.findById(id);
    } else if (user.role.name === 'HOD') {
      assessment = await Assessment.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      assessment = await Assessment.findOne({
        _id: id,
        $or: [
          { createdBy: user._id },
          { groups: { $in: user.groups } }
        ]
      });
    } else {
      // Student - can only see their own results
      assessment = await Assessment.findOne({
        _id: id,
        groups: { $in: user.groups }
      });
    }

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found or access denied'
      });
    }

    // Check if results should be shown
    const now = new Date();
    const showResults = assessment.showResultsImmediately || now > assessment.endTime;

    if (!showResults && user.role.name === 'Student') {
      return res.status(403).json({
        success: false,
        error: 'Results are not yet available'
      });
    }

    if (user.role.name === 'Student') {
      // Return student's own results
      const submission = await AssessmentSubmission.findOne({
        assessment: id,
        student: user._id
      }).populate({
        path: 'mcqAnswers.question',
        select: 'question options correctAnswer explanation'
      }).populate({
        path: 'codingSubmissions.question',
        select: 'title description testCases'
      });

      if (!submission || submission.status !== 'submitted') {
        return res.status(404).json({
          success: false,
          error: 'No submitted assessment found'
        });
      }

      return res.json({
        success: true,
        data: {
          assessment: {
            _id: assessment._id,
            title: assessment.title,
            totalPoints: assessment.totalPoints,
            passingScore: assessment.passingScore
          },
          submission: {
            submittedAt: submission.submittedAt,
            timeTaken: submission.timeTaken,
            scores: {
              mcq: submission.mcqScore,
              coding: submission.codingScore,
              total: submission.totalScore,
              percentage: (submission.totalScore / assessment.totalPoints) * 100
            },
            passed: (submission.totalScore / assessment.totalPoints) * 100 >= assessment.passingScore,
            mcqAnswers: assessment.showCorrectAnswers ? submission.mcqAnswers : undefined,
            codingSubmissions: submission.codingSubmissions
          }
        }
      });
    }

    // For teachers/admins - return all results
    const submissions = await AssessmentSubmission.find({
      assessment: id,
      status: 'submitted'
    })
    .populate('student', 'fullName email')
    .sort({ totalScore: -1 });

    const results = submissions.map((submission, index) => ({
      rank: index + 1,
      student: submission.student,
      submittedAt: submission.submittedAt,
      timeTaken: submission.timeTaken,
      scores: {
        mcq: submission.mcqScore,
        coding: submission.codingScore,
        total: submission.totalScore,
        percentage: (submission.totalScore / assessment.totalPoints) * 100
      },
      passed: (submission.totalScore / assessment.totalPoints) * 100 >= assessment.passingScore
    }));

    const statistics = {
      totalSubmissions: submissions.length,
      averageScore: submissions.reduce((sum, s) => sum + s.totalScore, 0) / submissions.length,
      averagePercentage: results.reduce((sum, r) => sum + r.scores.percentage, 0) / results.length,
      passedCount: results.filter(r => r.passed).length,
      failedCount: results.filter(r => !r.passed).length,
      passRate: (results.filter(r => r.passed).length / results.length) * 100
    };

    res.json({
      success: true,
      data: {
        assessment: {
          _id: assessment._id,
          title: assessment.title,
          totalPoints: assessment.totalPoints,
          passingScore: assessment.passingScore,
          totalQuestions: assessment.totalQuestions
        },
        results,
        statistics
      }
    });
  } catch (error) {
    console.error('Get assessment results error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessment results'
    });
  }
});

// DELETE /api/assessments/:id - Delete assessment
router.delete('/:id', requirePermission('manage_assessments'), idValidation, async (req, res) => {
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

    // Find assessment and check access
    let assessment;
    if (user.role.name === 'Admin') {
      assessment = await Assessment.findById(id);
    } else if (user.role.name === 'HOD') {
      assessment = await Assessment.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      assessment = await Assessment.findOne({ _id: id, createdBy: user._id });
    }

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found or access denied'
      });
    }

    // Check if assessment has submissions
    const submissionCount = await AssessmentSubmission.countDocuments({
      assessment: id
    });

    if (submissionCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete assessment with existing submissions'
      });
    }

    // Soft delete by setting isActive to false
    assessment.isActive = false;
    await assessment.save();

    res.json({
      success: true,
      message: 'Assessment deleted successfully'
    });
  } catch (error) {
    console.error('Delete assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete assessment'
    });
  }
});

// GET /api/assessments/stats - Get assessment statistics
router.get('/stats/overview', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const totalAssessments = await Assessment.countDocuments();
    const activeAssessments = await Assessment.countDocuments({ isActive: true });
    const publishedAssessments = await Assessment.countDocuments({ isPublished: true });

    const now = new Date();
    const upcomingAssessments = await Assessment.countDocuments({
      isActive: true,
      isPublished: true,
      startTime: { $gt: now }
    });

    const activeNowAssessments = await Assessment.countDocuments({
      isActive: true,
      isPublished: true,
      startTime: { $lte: now },
      endTime: { $gte: now }
    });

    const completedAssessments = await Assessment.countDocuments({
      isActive: true,
      endTime: { $lt: now }
    });

    // Department breakdown
    const departments = await Department.find({ isActive: true }).select('_id name code');
    const departmentStats = await Promise.all(
      departments.map(async (dept) => {
        const assessmentCount = await Assessment.countDocuments({
          department: dept._id,
          isActive: true
        });

        return {
          department: dept,
          assessmentCount
        };
      })
    );

    res.json({
      success: true,
      data: {
        overview: {
          totalAssessments,
          activeAssessments,
          publishedAssessments,
          upcomingAssessments,
          activeNowAssessments,
          completedAssessments
        },
        byDepartment: departmentStats.sort((a, b) => b.assessmentCount - a.assessmentCount)
      }
    });
  } catch (error) {
    console.error('Get assessment stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessment statistics'
    });
  }
});

module.exports = router;