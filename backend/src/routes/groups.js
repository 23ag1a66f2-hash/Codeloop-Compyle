const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { requireAuth, requirePermission, requireOwnership } = require('../middleware/auth');
const { Group, User, Department, Module, Assessment } = require('../models');

const router = express.Router();

// All group routes require authentication
router.use(requireAuth);

// Validation rules
const createGroupValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Group name is required')
    .isLength({ max: 100 })
    .withMessage('Group name cannot exceed 100 characters'),
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Group code is required')
    .isLength({ min: 2, max: 10 })
    .withMessage('Group code must be 2-10 characters')
    .matches(/^[A-Za-z0-9]{2,10}$/)
    .withMessage('Group code must contain only letters and numbers'),
  body('department')
    .isMongoId()
    .withMessage('Invalid department ID'),
  body('teacher')
    .isMongoId()
    .withMessage('Invalid teacher ID'),
  body('maxCapacity')
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage('Maximum capacity must be between 1 and 200')
];

const updateGroupValidation = [
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Group name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Group name cannot exceed 100 characters'),
  body('code')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Group code cannot be empty')
    .isLength({ min: 2, max: 10 })
    .withMessage('Group code must be 2-10 characters')
    .matches(/^[A-Za-z0-9]{2,10}$/)
    .withMessage('Group code must contain only letters and numbers'),
  body('teacher')
    .optional()
    .isMongoId()
    .withMessage('Invalid teacher ID'),
  body('maxCapacity')
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage('Maximum capacity must be between 1 and 200')
];

const idValidation = [
  param('id').isMongoId().withMessage('Invalid group ID')
];

const bulkStudentValidation = [
  body('studentIds').isArray().withMessage('Student IDs must be an array'),
  body('studentIds.*').isMongoId().withMessage('Invalid student ID')
];

// GET /api/groups - List groups with role-based filtering
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const {
      page = 1,
      limit = 10,
      search,
      department,
      teacher,
      isActive,
      hasAvailableSlots
    } = req.query;

    // Build query based on user role
    let query = {};

    // Filter by active status if specified
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Apply search filter if provided
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search.toUpperCase(), $options: 'i' } }
      ];
    }

    // Apply department filter if specified
    if (department) {
      query.department = department;
    }

    // Apply teacher filter if specified
    if (teacher) {
      query.teacher = teacher;
    }

    // Filter groups with available slots if requested
    if (hasAvailableSlots === 'true') {
      query.students = { $exists: true, $not: { $size: 0 } };
    }

    // Role-based access control
    if (user.role.name === 'Admin') {
      // Admin can see all groups
    } else if (user.role.name === 'HOD') {
      // HOD can see groups in their department
      query.department = user.department;
    } else if (user.role.name === 'Teacher') {
      // Teacher can see groups they're assigned to
      query.teacher = user._id;
    } else {
      // Student can see groups they're assigned to
      query.students = user._id;
    }

    const groups = await Group.find(query)
      .populate('department', 'name code')
      .populate('teacher', 'fullName email')
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Group.countDocuments(query);

    // Get detailed information for each group
    const groupsWithDetails = await Promise.all(
      groups.map(async (group) => {
        const studentCount = await User.countDocuments({
          groups: group._id,
          role: 'Student',
          isActive: true
        });
        const moduleCount = await Module.countDocuments({
          groups: group._id,
          isActive: true
        });
        const assessmentCount = await Assessment.countDocuments({
          groups: group._id,
          isActive: true
        });

        const isAtCapacity = studentCount >= group.maxCapacity;
        const availableSlots = Math.max(0, group.maxCapacity - studentCount);

        return {
          ...group.toObject(),
          studentCount,
          moduleCount,
          assessmentCount,
          isAtCapacity,
          availableSlots,
          capacityPercentage: (studentCount / group.maxCapacity) * 100
        };
      })
    );

    res.json({
      success: true,
      data: groupsWithDetails,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch groups'
    });
  }
});

// GET /api/groups/:id - Get group details
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

    let group;
    let accessCheck = true;

    // Check access based on user role
    if (user.role.name === 'Admin') {
      group = await Group.findById(id);
    } else if (user.role.name === 'HOD') {
      group = await Group.findOne({
        _id: id,
        department: user.department
      });
    } else if (user.role.name === 'Teacher') {
      group = await Group.findOne({
        _id: id,
        teacher: user._id
      });
    } else {
      // Student - check if they're in the group
      group = await Group.findOne({
        _id: id,
        students: user._id
      });
    }

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied'
      });
    }

    // Get full group details
    const groupDetails = await Group.getWithDetails(id);

    // Get additional statistics
    const studentCount = await User.countDocuments({
      groups: group._id,
      role: 'Student',
      isActive: true
    });
    const moduleCount = await Module.countDocuments({
      groups: group._id,
      isActive: true
    });
    const assessmentCount = await Assessment.countDocuments({
      groups: group._id,
      isActive: true
    });

    // Get recent activity
    const recentAssessments = await Assessment.find({
      groups: group._id,
      isActive: true
    })
      .select('title startTime duration')
      .sort({ startTime: -1 })
      .limit(5);

    const recentModules = await Module.find({
      groups: group._id,
      isActive: true
    })
      .select('title description createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    const result = {
      ...groupDetails.toObject(),
      studentCount,
      moduleCount,
      assessmentCount,
      isAtCapacity: studentCount >= group.maxCapacity,
      availableSlots: Math.max(0, group.maxCapacity - studentCount),
      capacityPercentage: (studentCount / group.maxCapacity) * 100,
      recentActivity: {
        assessments: recentAssessments,
        modules: recentModules
      }
    };

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch group details'
    });
  }
});

// POST /api/groups - Create new group
router.post('/', requirePermission('manage_groups'), createGroupValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { name, code, department, teacher, maxCapacity = 50 } = req.body;

    // Check if group code already exists
    const existingGroup = await Group.findOne({ code: code.toUpperCase() });
    if (existingGroup) {
      return res.status(400).json({
        success: false,
        error: 'Group code already exists'
      });
    }

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
        error: 'Cannot create group in another department'
      });
    }

    // Validate teacher
    const teacherUser = await User.findById(teacher).populate('role');
    if (!teacherUser || !['Teacher', 'HOD'].includes(teacherUser.role.name)) {
      return res.status(400).json({
        success: false,
        error: 'Teacher must be a user with Teacher or HOD role'
      });
    }

    // Check if teacher belongs to the department
    if (!teacherUser.department || !teacherUser.department.equals(department)) {
      return res.status(400).json({
        success: false,
        error: 'Teacher must belong to the same department'
      });
    }

    const group = new Group({
      name: name.trim(),
      code: code.toUpperCase(),
      department,
      teacher,
      maxCapacity
    });

    await group.save();

    const populatedGroup = await Group.findById(group._id)
      .populate('department', 'name code')
      .populate('teacher', 'fullName email');

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: populatedGroup
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create group'
    });
  }
});

// PUT /api/groups/:id - Update group
router.put('/:id', idValidation, updateGroupValidation, async (req, res) => {
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
    const { name, code, teacher, maxCapacity } = req.body;

    // Find group and check access
    let group;
    if (user.role.name === 'Admin') {
      group = await Group.findById(id);
    } else if (user.role.name === 'HOD') {
      group = await Group.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      group = await Group.findOne({ _id: id, teacher: user._id });
    }

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied'
      });
    }

    // Check for duplicate code (if being changed)
    if (code && code !== group.code) {
      const existingGroup = await Group.findOne({ code: code.toUpperCase() });
      if (existingGroup) {
        return res.status(400).json({
          success: false,
          error: 'Group code already exists'
        });
      }
    }

    // Validate new teacher if being changed
    if (teacher && teacher !== group.teacher?.toString()) {
      const teacherUser = await User.findById(teacher).populate('role');
      if (!teacherUser || !['Teacher', 'HOD'].includes(teacherUser.role.name)) {
        return res.status(400).json({
          success: false,
          error: 'Teacher must be a user with Teacher or HOD role'
        });
      }

      // Check if teacher belongs to the same department
      if (!teacherUser.department || !teacherUser.department.equals(group.department)) {
        return res.status(400).json({
          success: false,
          error: 'Teacher must belong to the same department as the group'
        });
      }
    }

    // Check if reducing capacity would exceed current student count
    if (maxCapacity && maxCapacity < group.students.length) {
      return res.status(400).json({
        success: false,
        error: `Cannot reduce capacity below current student count (${group.students.length})`
      });
    }

    // Update group
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (code) updateData.code = code.toUpperCase();
    if (teacher !== undefined) updateData.teacher = teacher;
    if (maxCapacity !== undefined) updateData.maxCapacity = maxCapacity;

    const updatedGroup = await Group.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('department', 'name code')
     .populate('teacher', 'fullName email');

    res.json({
      success: true,
      message: 'Group updated successfully',
      data: updatedGroup
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update group'
    });
  }
});

// DELETE /api/groups/:id - Soft delete group
router.delete('/:id', requirePermission('manage_groups'), idValidation, async (req, res) => {
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

    // Find group and check access
    let group;
    if (user.role.name === 'Admin') {
      group = await Group.findById(id);
    } else if (user.role.name === 'HOD') {
      group = await Group.findOne({ _id: id, department: user.department });
    }

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied'
      });
    }

    // Check if group has active modules or assessments
    const activeModules = await Module.countDocuments({
      groups: id,
      isActive: true
    });
    const activeAssessments = await Assessment.countDocuments({
      groups: id,
      isActive: true
    });

    if (activeModules > 0 || activeAssessments > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete group with active modules or assessments'
      });
    }

    // Remove group from all students
    await User.updateMany(
      { groups: id },
      { $pull: { groups: id } }
    );

    // Soft delete by setting isActive to false
    group.isActive = false;
    await group.save();

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete group'
    });
  }
});

// POST /api/groups/:id/students - Add students to group
router.post('/:id/students', idValidation, bulkStudentValidation, async (req, res) => {
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
    const { studentIds } = req.body;

    // Find group and check access
    let group;
    if (user.role.name === 'Admin') {
      group = await Group.findById(id);
    } else if (user.role.name === 'HOD') {
      group = await Group.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      group = await Group.findOne({ _id: id, teacher: user._id });
    }

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied'
      });
    }

    // Validate all students
    const students = await User.find({
      _id: { $in: studentIds },
      role: 'Student',
      isActive: true
    }).populate('role');

    if (students.length !== studentIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Some students are not valid or inactive'
      });
    }

    // Check if students belong to the same department
    const invalidStudents = students.filter(student =>
      !student.department || !student.department.equals(group.department)
    );

    if (invalidStudents.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'All students must belong to the same department as the group'
      });
    }

    // Check capacity
    const currentStudentCount = group.students.length;
    const newStudentCount = currentStudentCount + studentIds.length;

    if (newStudentCount > group.maxCapacity) {
      return res.status(400).json({
        success: false,
        error: `Cannot add students. Group capacity is ${group.maxCapacity}, trying to add ${newStudentCount} students`
      });
    }

    // Filter out students already in the group
    const studentsToAdd = studentIds.filter(id => !group.students.includes(id));

    if (studentsToAdd.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'All specified students are already in the group'
      });
    }

    // Add students to group
    group.students.push(...studentsToAdd);
    await group.save();

    // Add group to students
    await User.updateMany(
      { _id: { $in: studentsToAdd } },
      { $push: { groups: group._id } }
    );

    const updatedGroup = await Group.findById(id)
      .populate('students', 'fullName email profilePhoto');

    res.json({
      success: true,
      message: `Successfully added ${studentsToAdd.length} students to group`,
      data: updatedGroup
    });
  } catch (error) {
    console.error('Add students error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add students to group'
    });
  }
});

// DELETE /api/groups/:id/students/:studentId - Remove student from group
router.delete('/:id/students/:studentId', idValidation, [
  param('studentId').isMongoId().withMessage('Invalid student ID')
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
    const { id, studentId } = req.params;

    // Find group and check access
    let group;
    if (user.role.name === 'Admin') {
      group = await Group.findById(id);
    } else if (user.role.name === 'HOD') {
      group = await Group.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      group = await Group.findOne({ _id: id, teacher: user._id });
    }

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied'
      });
    }

    // Check if student is in the group
    if (!group.students.includes(studentId)) {
      return res.status(400).json({
        success: false,
        error: 'Student is not in this group'
      });
    }

    // Remove student from group
    group.students = group.students.filter(id => !id.equals(studentId));
    await group.save();

    // Remove group from student
    await User.findByIdAndUpdate(studentId, {
      $pull: { groups: group._id }
    });

    res.json({
      success: true,
      message: 'Student removed from group successfully'
    });
  } catch (error) {
    console.error('Remove student error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove student from group'
    });
  }
});

// GET /api/groups/:id/performance - Get group performance statistics
router.get('/:id/performance', idValidation, async (req, res) => {
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

    // Check access to group
    let group;
    if (user.role.name === 'Admin') {
      group = await Group.findById(id);
    } else if (user.role.name === 'HOD') {
      group = await Group.findOne({ _id: id, department: user.department });
    } else if (user.role.name === 'Teacher') {
      group = await Group.findOne({ _id: id, teacher: user._id });
    }

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied'
      });
    }

    // Get performance metrics for students in this group
    const PerformanceMetric = require('../models/PerformanceMetric');
    const metrics = await PerformanceMetric.find({
      group: group._id
    }).populate('student', 'fullName email');

    // Get recent assessments for this group
    const recentAssessments = await Assessment.find({
      groups: group._id,
      isActive: true
    })
      .select('title startTime duration')
      .sort({ startTime: -1 })
      .limit(10);

    // Calculate overall performance statistics
    const studentPerformance = await Promise.all(
      group.students.map(async (studentId) => {
        const student = await User.findById(studentId, 'fullName email');
        const studentMetrics = await PerformanceMetric.find({
          student: studentId,
          group: group._id
        });

        const totalAssessments = studentMetrics.reduce((sum, metric) =>
          sum + (metric.completedAssessments || 0), 0
        );
        const averageScore = studentMetrics.reduce((sum, metric) =>
          sum + (metric.averageAssessmentScore || 0), 0
        ) / (studentMetrics.length || 1);

        return {
          student,
          totalAssessments,
          averageScore,
          modulesCompleted: studentMetrics.length
        };
      })
    );

    res.json({
      success: true,
      data: {
        group: {
          _id: group._id,
          name: group.name,
          code: group.code
        },
        studentPerformance,
        recentAssessments,
        summary: {
          totalStudents: group.students.length,
          activeStudents: studentPerformance.length,
          averageGroupScore: studentPerformance.reduce((sum, s) => sum + s.averageScore, 0) / (studentPerformance.length || 1)
        }
      }
    });
  } catch (error) {
    console.error('Get group performance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch group performance'
    });
  }
});

// GET /api/groups/stats - Get groups overview statistics
router.get('/stats/overview', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const totalGroups = await Group.countDocuments();
    const activeGroups = await Group.countDocuments({ isActive: true });
    const groupsAtCapacity = await Group.countDocuments({
      isActive: true,
      $expr: { $gte: [{ $size: '$students' }, '$maxCapacity'] }
    });

    const departments = await Department.find({ isActive: true }).select('_id name code');
    const departmentStats = await Promise.all(
      departments.map(async (dept) => {
        const groupCount = await Group.countDocuments({
          department: dept._id,
          isActive: true
        });
        const studentCount = await User.countDocuments({
          department: dept._id,
          role: 'Student',
          isActive: true
        });

        return {
          department: dept,
          groupCount,
          studentCount,
          averageStudentsPerGroup: groupCount > 0 ? Math.round(studentCount / groupCount) : 0
        };
      })
    );

    res.json({
      success: true,
      data: {
        overview: {
          totalGroups,
          activeGroups,
          groupsAtCapacity,
          groupsWithAvailability: activeGroups - groupsAtCapacity
        },
        byDepartment: departmentStats.sort((a, b) => b.groupCount - a.groupCount)
      }
    });
  } catch (error) {
    console.error('Get group stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch group statistics'
    });
  }
});

module.exports = router;