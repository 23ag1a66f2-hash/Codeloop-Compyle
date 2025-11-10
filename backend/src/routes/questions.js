const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { requireAuth, requirePermission, requireOwnership } = require('../middleware/auth');
const { Question, User, Department, Module, PerformanceMetric } = require('../models');

const router = express.Router();

// All question routes require authentication
router.use(requireAuth);

// Validation rules for creating questions
const createCodingQuestionValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Question title is required')
    .isLength({ max: 300 })
    .withMessage('Question title cannot exceed 300 characters'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Question description is required'),
  body('difficulty')
    .optional()
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Invalid difficulty level'),
  body('department')
    .isMongoId()
    .withMessage('Invalid department ID'),
  body('modules')
    .optional()
    .isArray()
    .withMessage('Modules must be an array'),
  body('modules.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid module ID'),
  body('language')
    .isIn(['python', 'java', 'c', 'cpp', 'javascript'])
    .withMessage('Invalid programming language'),
  body('testCases')
    .isArray({ min: 1 })
    .withMessage('At least one test case is required'),
  body('testCases.*.input')
    .notEmpty()
    .withMessage('Test case input is required'),
  body('testCases.*.expectedOutput')
    .notEmpty()
    .withMessage('Test case expected output is required'),
  body('testCases.*.isHidden')
    .optional()
    .isBoolean()
    .withMessage('Test case visibility must be boolean'),
  body('testCases.*.points')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Test case points must be between 1 and 100'),
  body('starterCode')
    .optional()
    .trim(),
  body('solutionCode')
    .optional()
    .trim(),
  body('timeLimit')
    .optional()
    .isFloat({ min: 0.1, max: 10 })
    .withMessage('Time limit must be between 0.1 and 10 seconds'),
  body('memoryLimit')
    .optional()
    .isInt({ min: 16, max: 1024 })
    .withMessage('Memory limit must be between 16 and 1024 MB'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Each tag cannot exceed 50 characters'),
  body('hints')
    .optional()
    .isArray()
    .withMessage('Hints must be an array'),
  body('hints.*')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Each hint cannot exceed 200 characters')
];

const createMCQQuestionValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Question title is required')
    .isLength({ max: 300 })
    .withMessage('Question title cannot exceed 300 characters'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Question description is required'),
  body('difficulty')
    .optional()
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Invalid difficulty level'),
  body('department')
    .isMongoId()
    .withMessage('Invalid department ID'),
  body('modules')
    .optional()
    .isArray()
    .withMessage('Modules must be an array'),
  body('modules.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid module ID'),
  body('options')
    .isArray({ min: 2 })
    .withMessage('At least 2 options are required'),
  body('options.*')
    .trim()
    .notEmpty()
    .withMessage('Option cannot be empty'),
  body('correctAnswer')
    .isInt({ min: 0 })
    .withMessage('Correct answer must be a non-negative integer'),
  body('explanation')
    .optional()
    .trim(),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Each tag cannot exceed 50 characters')
];

const updateQuestionValidation = [
  body('title')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Question title cannot be empty')
    .isLength({ max: 300 })
    .withMessage('Question title cannot exceed 300 characters'),
  body('description')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Question description cannot be empty'),
  body('difficulty')
    .optional()
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Invalid difficulty level'),
  body('modules')
    .optional()
    .isArray()
    .withMessage('Modules must be an array'),
  body('modules.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid module ID'),
  body('testCases')
    .optional()
    .isArray()
    .withMessage('Test cases must be an array'),
  body('options')
    .optional()
    .isArray()
    .withMessage('Options must be an array'),
  body('correctAnswer')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Correct answer must be a non-negative integer'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Each tag cannot exceed 50 characters')
];

const idValidation = [
  param('id').isMongoId().withMessage('Invalid question ID')
];

const practiceSubmissionValidation = [
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Code is required for submission'),
  body('language')
    .isIn(['python', 'java', 'c', 'cpp', 'javascript'])
    .withMessage('Invalid programming language')
];

// GET /api/questions - List questions with role-based filtering
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const {
      page = 1,
      limit = 10,
      search,
      type,
      difficulty,
      department,
      modules,
      tags,
      language,
      createdBy,
      isActive,
      hasTestCases
    } = req.query;

    // Build query based on user role and filters
    let query = {};

    // Filter by active status if specified
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    } else {
      query.isActive = true; // Default to active questions only
    }

    // Apply search filter if provided
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Apply type filter
    if (type) {
      query.type = type;
    }

    // Apply difficulty filter
    if (difficulty) {
      query.difficulty = difficulty;
    }

    // Apply language filter (only for coding questions)
    if (language) {
      query.language = language;
    }

    // Apply department filter
    if (department) {
      query.department = department;
    }

    // Apply creator filter
    if (createdBy) {
      query.createdBy = createdBy;
    }

    // Apply modules filter
    if (modules) {
      const moduleArray = Array.isArray(modules) ? modules : [modules];
      query.modules = { $in: moduleArray };
    }

    // Apply tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      query.tags = { $in: tagArray };
    }

    // Filter questions with test cases if requested
    if (hasTestCases === 'true') {
      query.testCases = { $exists: true, $ne: [] };
    }

    // Role-based access control
    if (user.role.name === 'Admin') {
      // Admin can see all questions
    } else if (user.role.name === 'HOD') {
      // HOD can see questions in their department
      query.department = user.department;
    } else if (user.role.name === 'Teacher') {
      // Teacher can see questions they created or in their department
      query.$or = [
        { createdBy: user._id },
        { department: user.department }
      ];
    } else {
      // Student can see questions in their department and modules
      query.department = user.department;
    }

    const questions = await Question.find(query)
      .populate('department', 'name code')
      .populate('createdBy', 'fullName email')
      .populate('modules', 'title')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Question.countDocuments(query);

    // Get additional statistics for each question
    const questionsWithStats = await Promise.all(
      questions.map(async (question) => {
        const questionObj = question.toObject();
        questionObj.successRate = question.successRate;
        questionObj.totalPoints = question.totalPoints;
        return questionObj;
      })
    );

    res.json({
      success: true,
      data: questionsWithStats,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch questions'
    });
  }
});

// GET /api/questions/:id - Get question details
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

    let question;
    let accessCheck = false;

    // Check access based on user role
    if (user.role.name === 'Admin') {
      question = await Question.findById(id);
      accessCheck = true;
    } else if (user.role.name === 'HOD') {
      question = await Question.findOne({ _id: id, department: user.department });
      accessCheck = true;
    } else if (user.role.name === 'Teacher') {
      question = await Question.findOne({
        _id: id,
        $or: [
          { createdBy: user._id },
          { department: user.department }
        ]
      });
      accessCheck = true;
    } else {
      // Student - check if question is in their department/modules
      question = await Question.findOne({
        _id: id,
        department: user.department,
        isActive: true
      });
      accessCheck = true;
    }

    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found or access denied'
      });
    }

    // Get full question details
    const questionDetails = await Question.getWithDetails(id);

    // For students, hide test case solutions and expected outputs for hidden test cases
    if (user.role.name === 'Student') {
      if (questionDetails.type === 'coding') {
        questionDetails.testCases = questionDetails.testCases.map(testCase => ({
          ...testCase.toObject(),
          expectedOutput: testCase.isHidden ? undefined : testCase.expectedOutput
        }));
      }
      // Don't show solution code to students
      questionDetails.solutionCode = undefined;
    }

    // Add statistics
    const questionObj = questionDetails.toObject();
    questionObj.successRate = questionDetails.successRate;
    questionObj.totalPoints = questionDetails.totalPoints;

    res.json({
      success: true,
      data: questionObj
    });
  } catch (error) {
    console.error('Get question error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch question details'
    });
  }
});

// POST /api/questions - Create new coding question
router.post('/coding', requirePermission('manage_questions'), createCodingQuestionValidation, async (req, res) => {
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
      difficulty = 'medium',
      department,
      modules = [],
      language,
      testCases,
      starterCode,
      solutionCode,
      timeLimit = 1,
      memoryLimit = 128,
      tags = [],
      hints = []
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
        error: 'Cannot create question in another department'
      });
    }

    // Validate modules if provided
    if (modules.length > 0) {
      const validModules = await Module.find({
        _id: { $in: modules },
        department: department,
        isActive: true
      });

      if (validModules.length !== modules.length) {
        return res.status(400).json({
          success: false,
          error: 'Some modules are invalid or belong to different department'
        });
      }
    }

    const question = new Question({
      title: title.trim(),
      description: description.trim(),
      type: 'coding',
      difficulty,
      department,
      modules,
      createdBy: user._id,
      language,
      testCases,
      starterCode: starterCode?.trim(),
      solutionCode: solutionCode?.trim(),
      timeLimit,
      memoryLimit,
      tags: tags.map(tag => tag.trim().toLowerCase()),
      hints: hints.map(hint => hint.trim())
    });

    await question.save();

    const populatedQuestion = await Question.findById(question._id)
      .populate('department', 'name code')
      .populate('createdBy', 'fullName email')
      .populate('modules', 'title');

    res.status(201).json({
      success: true,
      message: 'Coding question created successfully',
      data: populatedQuestion
    });
  } catch (error) {
    console.error('Create coding question error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create coding question'
    });
  }
});

// POST /api/questions/mcq - Create new MCQ question
router.post('/mcq', requirePermission('manage_questions'), createMCQQuestionValidation, async (req, res) => {
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
      difficulty = 'medium',
      department,
      modules = [],
      options,
      correctAnswer,
      explanation,
      tags = []
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
        error: 'Cannot create question in another department'
      });
    }

    // Validate modules if provided
    if (modules.length > 0) {
      const validModules = await Module.find({
        _id: { $in: modules },
        department: department,
        isActive: true
      });

      if (validModules.length !== modules.length) {
        return res.status(400).json({
          success: false,
          error: 'Some modules are invalid or belong to different department'
        });
      }
    }

    // Validate correct answer index
    if (correctAnswer < 0 || correctAnswer >= options.length) {
      return res.status(400).json({
        success: false,
        error: 'Correct answer must be a valid option index'
      });
    }

    const question = new Question({
      title: title.trim(),
      description: description.trim(),
      type: 'mcq',
      difficulty,
      department,
      modules,
      createdBy: user._id,
      options: options.map(option => option.trim()),
      correctAnswer,
      explanation: explanation?.trim(),
      tags: tags.map(tag => tag.trim().toLowerCase())
    });

    await question.save();

    const populatedQuestion = await Question.findById(question._id)
      .populate('department', 'name code')
      .populate('createdBy', 'fullName email')
      .populate('modules', 'title');

    res.status(201).json({
      success: true,
      message: 'MCQ question created successfully',
      data: populatedQuestion
    });
  } catch (error) {
    console.error('Create MCQ question error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create MCQ question'
    });
  }
});

// PUT /api/questions/:id - Update question
router.put('/:id', idValidation, updateQuestionValidation, async (req, res) => {
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
      'title', 'description', 'difficulty', 'modules', 'testCases',
      'options', 'correctAnswer', 'explanation', 'tags', 'hints',
      'starterCode', 'solutionCode', 'timeLimit', 'memoryLimit'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (['title', 'description', 'explanation', 'starterCode', 'solutionCode'].includes(field)) {
          updateData[field] = req.body[field].trim();
        } else if (field === 'tags') {
          updateData[field] = req.body[field].map(tag => tag.trim().toLowerCase());
        } else if (field === 'hints') {
          updateData[field] = req.body[field].map(hint => hint.trim());
        } else if (field === 'options') {
          updateData[field] = req.body[field].map(option => option.trim());
        } else {
          updateData[field] = req.body[field];
        }
      }
    });

    // Find question and check access
    let question;
    if (user.role.name === 'Admin') {
      question = await Question.findById(id);
    } else if (user.role.name === 'HOD') {
      question = await Question.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      question = await Question.findOne({ _id: id, createdBy: user._id });
    }

    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found or access denied'
      });
    }

    // Validate modules if being updated
    if (updateData.modules) {
      const validModules = await Module.find({
        _id: { $in: updateData.modules },
        department: question.department,
        isActive: true
      });

      if (validModules.length !== updateData.modules.length) {
        return res.status(400).json({
          success: false,
          error: 'Some modules are invalid or belong to different department'
        });
      }
    }

    // Validate question type-specific updates
    if (question.type === 'coding') {
      if (updateData.testCases && updateData.testCases.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Coding questions must have at least one test case'
        });
      }
    } else if (question.type === 'mcq') {
      if (updateData.options && updateData.options.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'MCQ questions must have at least 2 options'
        });
      }

      // Validate correct answer if options are being updated
      if (updateData.options && updateData.correctAnswer !== undefined) {
        if (updateData.correctAnswer < 0 || updateData.correctAnswer >= updateData.options.length) {
          return res.status(400).json({
            success: false,
            error: 'Correct answer must be a valid option index'
          });
        }
      }
    }

    const updatedQuestion = await Question.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('department', 'name code')
     .populate('createdBy', 'fullName email')
     .populate('modules', 'title');

    res.json({
      success: true,
      message: 'Question updated successfully',
      data: updatedQuestion
    });
  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update question'
    });
  }
});

// DELETE /api/questions/:id - Soft delete question
router.delete('/:id', requirePermission('manage_questions'), idValidation, async (req, res) => {
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

    // Find question and check access
    let question;
    if (user.role.name === 'Admin') {
      question = await Question.findById(id);
    } else if (user.role.name === 'HOD') {
      question = await Question.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      question = await Question.findOne({ _id: id, createdBy: user._id });
    }

    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found or access denied'
      });
    }

    // Check if question is used in active assessments
    const Assessment = require('../models/Assessment');
    const activeAssessments = await Assessment.countDocuments({
      $or: [
        { 'codingQuestions.question': id },
        { 'mcqQuestions.question': id }
      ],
      isActive: true
    });

    if (activeAssessments > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete question used in active assessments'
      });
    }

    // Check if question is assigned to active modules
    const activeModules = await Module.countDocuments({
      questions: id,
      isActive: true
    });

    if (activeModules > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete question assigned to active modules'
      });
    }

    // Soft delete by setting isActive to false
    question.isActive = false;
    await question.save();

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete question'
    });
  }
});

// POST /api/questions/:id/submit - Submit practice solution
router.post('/:id/submit', idValidation, practiceSubmissionValidation, async (req, res) => {
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
    const { code, language } = req.body;

    // Only students can submit practice solutions
    if (user.role.name !== 'Student') {
      return res.status(403).json({
        success: false,
        error: 'Only students can submit practice solutions'
      });
    }

    // Find question and check access
    const question = await Question.findOne({
      _id: id,
      department: user.department,
      isActive: true
    });

    if (!question || question.type !== 'coding') {
      return res.status(404).json({
        success: false,
        error: 'Coding question not found or access denied'
      });
    }

    // Validate language matches question
    if (question.language && language !== question.language) {
      return res.status(400).json({
        success: false,
        error: `This question must be solved in ${question.language}`
      });
    }

    // Increment attempt count
    await question.incrementAttempts();

    // Queue code execution (this would integrate with Judge0 service)
    // For now, we'll return a submission ID
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Update performance metrics (placeholder - would be updated after execution)
    const PerformanceMetric = require('../models/PerformanceMetric');
    await PerformanceMetric.findOneAndUpdate(
      {
        student: user._id,
        question: id,
        department: user.department
      },
      {
        $inc: { totalPracticeSubmissions: 1 },
        lastAttemptedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Practice solution submitted successfully',
      data: {
        submissionId,
        status: 'queued',
        estimatedTime: '2-5 seconds'
      }
    });
  } catch (error) {
    console.error('Submit practice solution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit practice solution'
    });
  }
});

// GET /api/questions/:id/submissions - Get submission history for a question
router.get('/:id/submissions', idValidation, async (req, res) => {
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

    // Find question and check access
    let question;
    if (user.role.name === 'Admin') {
      question = await Question.findById(id);
    } else if (user.role.name === 'HOD') {
      question = await Question.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      question = await Question.findOne({
        _id: id,
        $or: [
          { createdBy: user._id },
          { department: user.department }
        ]
      });
    } else {
      // Student - can only see their own submissions
      question = await Question.findOne({
        _id: id,
        department: user.department,
        isActive: true
      });
    }

    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found or access denied'
      });
    }

    // Get submission history based on user role
    let submissions;
    if (user.role.name === 'Student') {
      // Students can only see their own submissions
      // This would query a submissions collection (not implemented yet)
      submissions = []; // Placeholder
    } else {
      // Teachers and admins can see all submissions for this question
      submissions = []; // Placeholder
    }

    res.json({
      success: true,
      data: {
        question: {
          _id: question._id,
          title: question.title,
          type: question.type,
          difficulty: question.difficulty
        },
        submissions,
        statistics: {
          totalAttempts: question.attempts,
          successfulSubmissions: question.successfulSubmissions,
          successRate: question.successRate
        }
      }
    });
  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch submissions'
    });
  }
});

// GET /api/questions/stats - Get question statistics
router.get('/stats/overview', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const totalQuestions = await Question.countDocuments();
    const activeQuestions = await Question.countDocuments({ isActive: true });
    const codingQuestions = await Question.countDocuments({ type: 'coding', isActive: true });
    const mcqQuestions = await Question.countDocuments({ type: 'mcq', isActive: true });

    // Difficulty breakdown
    const easyQuestions = await Question.countDocuments({ difficulty: 'easy', isActive: true });
    const mediumQuestions = await Question.countDocuments({ difficulty: 'medium', isActive: true });
    const hardQuestions = await Question.countDocuments({ difficulty: 'hard', isActive: true });

    // Language breakdown for coding questions
    const languageStats = await Question.aggregate([
      { $match: { type: 'coding', isActive: true } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Department breakdown
    const departments = await Department.find({ isActive: true }).select('_id name code');
    const departmentStats = await Promise.all(
      departments.map(async (dept) => {
        const questionCount = await Question.countDocuments({
          department: dept._id,
          isActive: true
        });

        return {
          department: dept,
          questionCount,
          codingQuestions: await Question.countDocuments({
            department: dept._id,
            type: 'coding',
            isActive: true
          }),
          mcqQuestions: await Question.countDocuments({
            department: dept._id,
            type: 'mcq',
            isActive: true
          })
        };
      })
    );

    res.json({
      success: true,
      data: {
        overview: {
          totalQuestions,
          activeQuestions,
          inactiveQuestions: totalQuestions - activeQuestions,
          codingQuestions,
          mcqQuestions
        },
        difficultyBreakdown: {
          easy: easyQuestions,
          medium: mediumQuestions,
          hard: hardQuestions
        },
        languageBreakdown: languageStats,
        byDepartment: departmentStats.sort((a, b) => b.questionCount - a.questionCount)
      }
    });
  } catch (error) {
    console.error('Get question stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch question statistics'
    });
  }
});

// POST /api/questions/bulk-upload - Bulk upload MCQ questions from Excel
router.post('/bulk-upload', requirePermission('manage_questions'), async (req, res) => {
  try {
    // This would handle Excel file parsing and bulk creation
    // For now, return a placeholder response
    res.json({
      success: true,
      message: 'Bulk upload endpoint ready for implementation',
      data: {
        uploaded: 0,
        errors: [],
        total: 0
      }
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process bulk upload'
    });
  }
});

module.exports = router;