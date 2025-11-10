const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { requireAuth, requirePermission, requireOwnership } = require('../middleware/auth');
const { Department, User, Group, Module } = require('../models');

const router = express.Router();

// All department routes require authentication
router.use(requireAuth);

// Validation rules
const createDepartmentValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Department name is required')
    .isLength({ max: 100 })
    .withMessage('Department name cannot exceed 100 characters'),
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Department code is required')
    .isLength({ min: 2, max: 6 })
    .withMessage('Department code must be 2-6 characters')
    .matches(/^[A-Za-z]{2,6}$/)
    .withMessage('Department code must contain only letters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

const updateDepartmentValidation = [
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Department name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Department name cannot exceed 100 characters'),
  body('code')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Department code cannot be empty')
    .isLength({ min: 2, max: 6 })
    .withMessage('Department code must be 2-6 characters')
    .matches(/^[A-Za-z]{2,6}$/)
    .withMessage('Department code must contain only letters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

const idValidation = [
  param('id').isMongoId().withMessage('Invalid department ID')
];

// GET /api/departments - List departments with role-based filtering
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const { page = 1, limit = 10, search, isActive } = req.query;

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
        { code: { $regex: search.toUpperCase(), $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Admin can see all departments
    // HOD can only see their own department
    // Teachers and Students can only see their department
    if (user.role.name === 'HOD') {
      query.hod = user._id;
    } else if (['Teacher', 'Student'].includes(user.role.name)) {
      query._id = user.department;
    }

    const departments = await Department.find(query)
      .populate('hod', 'fullName email')
      .populate({
        path: 'teachers',
        select: 'fullName email',
        match: { isActive: true }
      })
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Department.countDocuments(query);

    // Get statistics for each department
    const departmentsWithStats = await Promise.all(
      departments.map(async (dept) => {
        const teacherCount = await User.countDocuments({
          department: dept._id,
          role: 'Teacher',
          isActive: true
        });
        const studentCount = await User.countDocuments({
          department: dept._id,
          role: 'Student',
          isActive: true
        });
        const groupCount = await Group.countDocuments({
          department: dept._id,
          isActive: true
        });

        return {
          ...dept.toObject(),
          teacherCount,
          studentCount,
          groupCount
        };
      })
    );

    res.json({
      success: true,
      data: departmentsWithStats,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch departments'
    });
  }
});

// GET /api/departments/:id - Get department details
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

    let department;

    // Admin can see any department
    // HOD can only see their own department
    // Teachers and Students can only see their department
    if (user.role.name === 'Admin') {
      department = await Department.getWithStats(id);
    } else if (user.role.name === 'HOD') {
      department = await Department.findOne({ _id: id, hod: user._id })
        .populate('hod', 'fullName email')
        .populate({
          path: 'teachers',
          select: 'fullName email groups',
          populate: {
            path: 'groups',
            select: 'name code'
          }
        });
    } else {
      department = await Department.findOne({ _id: id, _id: user.department })
        .populate('hod', 'fullName email')
        .populate('teachers', 'fullName email');
    }

    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found or access denied'
      });
    }

    // Get detailed statistics
    const teacherCount = await User.countDocuments({
      department: department._id,
      role: 'Teacher',
      isActive: true
    });
    const studentCount = await User.countDocuments({
      department: department._id,
      role: 'Student',
      isActive: true
    });
    const groupCount = await Group.countDocuments({
      department: department._id,
      isActive: true
    });
    const moduleCount = await Module.countDocuments({
      department: department._id,
      isActive: true
    });

    const groups = await Group.find({ department: department._id, isActive: true })
      .populate('teacher', 'fullName email')
      .populate('students', 'fullName email')
      .sort({ name: 1 });

    const result = {
      ...department.toObject(),
      teacherCount,
      studentCount,
      groupCount,
      moduleCount,
      groups
    };

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch department details'
    });
  }
});

// POST /api/departments - Create new department (Admin only)
router.post('/', requirePermission('manage_departments'), createDepartmentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { name, code, description, hod } = req.body;

    // Check if department name or code already exists
    const existingDept = await Department.findOne({
      $or: [{ name }, { code: code.toUpperCase() }]
    });

    if (existingDept) {
      return res.status(400).json({
        success: false,
        error: existingDept.name === name ?
          'Department name already exists' :
          'Department code already exists'
      });
    }

    // Validate HOD if provided
    if (hod) {
      const hodUser = await User.findById(hod).populate('role');
      if (!hodUser || hodUser.role.name !== 'HOD') {
        return res.status(400).json({
          success: false,
          error: 'HOD must be a user with HOD role'
        });
      }
    }

    const department = new Department({
      name: name.trim(),
      code: code.toUpperCase(),
      description: description?.trim(),
      hod: hod || null
    });

    await department.save();

    // Update HOD user if assigned
    if (hod) {
      await User.findByIdAndUpdate(hod, {
        department: department._id,
        groups: []
      });
    }

    const populatedDept = await Department.findById(department._id)
      .populate('hod', 'fullName email');

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: populatedDept
    });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create department'
    });
  }
});

// PUT /api/departments/:id - Update department
router.put('/:id', idValidation, updateDepartmentValidation, async (req, res) => {
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
    const { name, code, description, hod } = req.body;

    // Find department and check access
    let department;
    if (user.role.name === 'Admin') {
      department = await Department.findById(id);
    } else if (user.role.name === 'HOD') {
      department = await Department.findOne({ _id: id, hod: user._id });
    }

    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found or access denied'
      });
    }

    // Check for duplicate name or code (if being changed)
    if (name && name !== department.name) {
      const existingDept = await Department.findOne({ name });
      if (existingDept) {
        return res.status(400).json({
          success: false,
          error: 'Department name already exists'
        });
      }
    }

    if (code && code !== department.code) {
      const existingDept = await Department.findOne({ code: code.toUpperCase() });
      if (existingDept) {
        return res.status(400).json({
          success: false,
          error: 'Department code already exists'
        });
      }
    }

    // Validate HOD if being changed
    if (hod && hod !== department.hod?.toString()) {
      const hodUser = await User.findById(hod).populate('role');
      if (!hodUser || hodUser.role.name !== 'HOD') {
        return res.status(400).json({
          success: false,
          error: 'HOD must be a user with HOD role'
        });
      }
    }

    // Update department
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (code) updateData.code = code.toUpperCase();
    if (description !== undefined) updateData.description = description?.trim();
    if (hod !== undefined) updateData.hod = hod || null;

    const updatedDepartment = await Department.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('hod', 'fullName email');

    // Handle HOD change
    if (hod !== department.hod?.toString()) {
      // Remove old HOD's department reference
      if (department.hod) {
        await User.findByIdAndUpdate(department.hod, {
          $unset: { department: '' }
        });
      }

      // Set new HOD's department reference
      if (hod) {
        await User.findByIdAndUpdate(hod, {
          department: updatedDepartment._id,
          groups: []
        });
      }
    }

    res.json({
      success: true,
      message: 'Department updated successfully',
      data: updatedDepartment
    });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update department'
    });
  }
});

// DELETE /api/departments/:id - Soft delete department
router.delete('/:id', requirePermission('manage_departments'), idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const department = await Department.findById(id);

    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }

    // Check if department has active groups or modules
    const activeGroups = await Group.countDocuments({
      department: id,
      isActive: true
    });
    const activeModules = await Module.countDocuments({
      department: id,
      isActive: true
    });

    if (activeGroups > 0 || activeModules > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete department with active groups or modules'
      });
    }

    // Soft delete by setting isActive to false
    department.isActive = false;
    await department.save();

    res.json({
      success: true,
      message: 'Department deleted successfully'
    });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete department'
    });
  }
});

// GET /api/departments/:id/groups - Get department groups
router.get('/:id/groups', idValidation, async (req, res) => {
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

    // Check access to department
    let department;
    if (user.role.name === 'Admin') {
      department = await Department.findById(id);
    } else if (user.role.name === 'HOD') {
      department = await Department.findOne({ _id: id, hod: user._id });
    } else {
      department = await Department.findOne({ _id: id, _id: user.department });
    }

    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found or access denied'
      });
    }

    const groups = await Group.find({ department: id, isActive: true })
      .populate('teacher', 'fullName email')
      .populate('students', 'fullName email')
      .sort({ name: 1 });

    // Get student count for each group
    const groupsWithCounts = await Promise.all(
      groups.map(async (group) => {
        const studentCount = group.students ? group.students.length : 0;
        const moduleCount = await Module.countDocuments({
          groups: group._id,
          isActive: true
        });

        return {
          ...group.toObject(),
          studentCount,
          moduleCount
        };
      })
    );

    res.json({
      success: true,
      data: groupsWithCounts
    });
  } catch (error) {
    console.error('Get department groups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch department groups'
    });
  }
});

// POST /api/departments/:id/hod - Assign HOD to department
router.post('/:id/hod', requirePermission('manage_departments'), idValidation, [
  body('hodId').isMongoId().withMessage('Invalid HOD ID')
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

    const { id } = req.params;
    const { hodId } = req.body;

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }

    // Validate HOD user
    const hodUser = await User.findById(hodId).populate('role');
    if (!hodUser || hodUser.role.name !== 'HOD') {
      return res.status(400).json({
        success: false,
        error: 'HOD must be a user with HOD role'
      });
    }

    // Set HOD using the model method
    await department.setHOD(hodId);

    const updatedDepartment = await Department.findById(id).populate('hod', 'fullName email');

    res.json({
      success: true,
      message: 'HOD assigned successfully',
      data: updatedDepartment
    });
  } catch (error) {
    console.error('Assign HOD error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign HOD'
    });
  }
});

// GET /api/departments/stats - Get departments statistics (Admin only)
router.get('/stats/overview', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const totalDepartments = await Department.countDocuments();
    const activeDepartments = await Department.countDocuments({ isActive: true });
    const departmentsWithHOD = await Department.countDocuments({
      hod: { $exists: true, $ne: null }
    });

    const departments = await Department.find({ isActive: true })
      .select('_id name code')
      .lean();

    const departmentStats = await Promise.all(
      departments.map(async (dept) => {
        const teacherCount = await User.countDocuments({
          department: dept._id,
          role: 'Teacher',
          isActive: true
        });
        const studentCount = await User.countDocuments({
          department: dept._id,
          role: 'Student',
          isActive: true
        });
        const groupCount = await Group.countDocuments({
          department: dept._id,
          isActive: true
        });

        return {
          ...dept,
          teacherCount,
          studentCount,
          groupCount,
          totalUsers: teacherCount + studentCount
        };
      })
    );

    res.json({
      success: true,
      data: {
        overview: {
          totalDepartments,
          activeDepartments,
          departmentsWithHOD,
          departmentsWithoutHOD: activeDepartments - departmentsWithHOD
        },
        departments: departmentStats.sort((a, b) => b.totalUsers - a.totalUsers)
      }
    });
  } catch (error) {
    console.error('Get department stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch department statistics'
    });
  }
});

module.exports = router;