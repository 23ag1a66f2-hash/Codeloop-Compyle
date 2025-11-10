const express = require('express');
const { body, validationResult, param, query } = require('express-validator');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { Notice, User, Department, Group } = require('../models');

const router = express.Router();

// All notice routes require authentication
router.use(requireAuth);

// Validation rules
const createNoticeValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Notice title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Notice content is required'),
  body('targetType')
    .isIn(['all', 'department', 'group', 'role'])
    .withMessage('Invalid target type'),
  body('targetRoles')
    .optional()
    .isArray()
    .withMessage('Target roles must be an array'),
  body('targetRoles.*')
    .optional()
    .isIn(['Admin', 'HOD', 'Teacher', 'Student'])
    .withMessage('Invalid target role'),
  body('department')
    .optional()
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
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Invalid priority level'),
  body('expiresAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid expiration date')
    .custom(value => {
      if (value && new Date(value) <= new Date()) {
        throw new Error('Expiration date must be in the future');
      }
      return true;
    })
];

const updateNoticeValidation = [
  body('title')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Title cannot be empty')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('content')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Content cannot be empty'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Invalid priority level'),
  body('expiresAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid expiration date')
    .custom(value => {
      if (value && new Date(value) <= new Date()) {
        throw new Error('Expiration date must be in the future');
      }
      return true;
    })
];

const idValidation = [
  param('id').isMongoId().withMessage('Invalid notice ID')
];

// GET /api/notices - List notices with role-based filtering
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const {
      page = 1,
      limit = 10,
      search,
      department,
      group,
      targetType,
      priority,
      unread,
      isActive,
      postedBy
    } = req.query;

    // Build query based on user role and filters
    let query = { isActive: true };

    // Apply search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    // Apply department filter
    if (department) {
      query.department = department;
    }

    // Apply group filter
    if (group) {
      query.groups = group;
    }

    // Apply target type filter
    if (targetType) {
      query.targetType = targetType;
    }

    // Apply priority filter
    if (priority) {
      query.priority = priority;
    }

    // Apply active status filter
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Apply posted by filter
    if (postedBy) {
      query.postedBy = postedBy;
    }

    // Filter out expired notices
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    });

    // Role-based access control
    let accessibleNotices;
    if (user.role.name === 'Admin') {
      // Admin can see all notices
      accessibleNotices = await Notice.find(query);
    } else if (user.role.name === 'HOD') {
      // HOD can see all notices and department-specific notices for their department
      query.$or = [
        { targetType: 'all' },
        { targetType: 'role', targetRoles: { $in: [user.role.name] } },
        { targetType: 'department', department: user.department }
      ];
      accessibleNotices = await Notice.find(query);
    } else if (user.role.name === 'Teacher') {
      // Teacher can see role-based and group-specific notices
      query.$or = [
        { targetType: 'all' },
        { targetType: 'role', targetRoles: { $in: [user.role.name] } },
        { targetType: 'group', groups: { $in: user.groups } }
      ];
      accessibleNotices = await Notice.find(query);
    } else {
      // Student - use the static method for proper filtering
      accessibleNotices = await Notice.findByUser(user._id, {
        page: parseInt(page),
        limit: parseInt(limit),
        unread: unread === 'true'
      });

      const total = await Notice.countDocuments({
        isActive: true,
        $or: [
          { targetType: 'all' },
          { targetType: 'role', targetRoles: { $in: [user.role.name] } },
          { targetType: 'department', department: user.department },
          { targetType: 'group', groups: { $in: user.groups } }
        ],
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      return res.json({
        success: true,
        data: accessibleNotices,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total,
          limit: parseInt(limit)
        }
      });
    }

    // For Admin, HOD, and Teacher, apply additional filtering and pagination
    const notices = await Notice.find(query)
      .populate('postedBy', 'fullName')
      .populate('department', 'name code')
      .populate('groups', 'name code')
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Notice.countDocuments(query);

    // Filter for unread if requested
    let finalNotices = notices;
    if (unread === 'true') {
      finalNotices = notices.filter(notice =>
        !notice.readBy.some(readEntry => readEntry.user.toString() === user._id.toString())
      );
    }

    res.json({
      success: true,
      data: finalNotices,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get notices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notices'
    });
  }
});

// GET /api/notices/:id - Get notice details
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

    const { id } = req.params;
    const notice = await Notice.findById(id)
      .populate('postedBy', 'fullName email')
      .populate('department', 'name code')
      .populate('groups', 'name code')
      .populate('readBy.user', 'fullName');

    if (!notice) {
      return res.status(404).json({
        success: false,
        error: 'Notice not found'
      });
    }

    // Check if user has access to this notice
    const hasAccess = await notice.hasAccess(req.user.id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this notice'
      });
    }

    // Check if notice is expired
    if (notice.isExpired) {
      return res.status(404).json({
        success: false,
        error: 'Notice has expired'
      });
    }

    // Add additional metadata
    const noticeData = notice.toObject();
    noticeData.isRead = notice.readBy.some(readEntry =>
      readEntry.user._id.toString() === req.user.id.toString()
    );
    noticeData.targetAudience = notice.getTargetAudience();
    noticeData.readCount = notice.readCount;

    res.json({
      success: true,
      data: noticeData
    });
  } catch (error) {
    console.error('Get notice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notice details'
    });
  }
});

// POST /api/notices - Create new notice
router.post('/', requirePermission('post_notices'), createNoticeValidation, async (req, res) => {
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
      content,
      targetType,
      targetRoles = [],
      department,
      groups = [],
      priority = 'medium',
      expiresAt
    } = req.body;

    // Validate targeting based on type
    if (targetType === 'department' && !department) {
      return res.status(400).json({
        success: false,
        error: 'Department is required for department-specific notices'
      });
    }

    if (targetType === 'group' && groups.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one group is required for group-specific notices'
      });
    }

    if (targetType === 'role' && targetRoles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one target role is required for role-specific notices'
      });
    }

    // Validate department if provided
    if (department) {
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
          error: 'Cannot create notice for another department'
        });
      }
    }

    // Validate groups if provided
    if (groups.length > 0) {
      const validGroups = await Group.find({
        _id: { $in: groups },
        isActive: true
      });

      if (validGroups.length !== groups.length) {
        return res.status(400).json({
          success: false,
          error: 'Some groups are invalid or inactive'
        });
      }

      // Check teacher access to groups
      const user = await User.findById(req.user.id).populate('role');
      if (user.role.name === 'Teacher') {
        const teacherGroups = validGroups.filter(group =>
          group.teacher.toString() === user._id.toString()
        );

        if (teacherGroups.length !== validGroups.length) {
          return res.status(403).json({
            success: false,
            error: 'Can only create notices for groups you teach'
          });
        }
      }
    }

    const notice = new Notice({
      title: title.trim(),
      content: content.trim(),
      postedBy: req.user.id,
      targetType,
      targetRoles,
      department,
      groups,
      priority,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    });

    await notice.save();

    const populatedNotice = await Notice.findById(notice._id)
      .populate('postedBy', 'fullName email')
      .populate('department', 'name code')
      .populate('groups', 'name code');

    res.status(201).json({
      success: true,
      message: 'Notice created successfully',
      data: populatedNotice
    });
  } catch (error) {
    console.error('Create notice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create notice'
    });
  }
});

// PUT /api/notices/:id - Update notice
router.put('/:id', idValidation, updateNoticeValidation, async (req, res) => {
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
    const user = await User.findById(req.user.id).populate('role');

    // Find notice and check access
    let notice;
    if (user.role.name === 'Admin') {
      notice = await Notice.findById(id);
    } else if (user.role.name === 'HOD') {
      notice = await Notice.findOne({
        _id: id,
        $or: [
          { postedBy: user._id },
          { targetType: 'all' },
          { targetType: 'role', targetRoles: { $in: [user.role.name] } }
        ]
      });
    } else if (user.role.name === 'Teacher') {
      notice = await Notice.findOne({
        _id: id,
        postedBy: user._id
      });
    }

    if (!notice) {
      return res.status(404).json({
        success: false,
        error: 'Notice not found or access denied'
      });
    }

    // Update notice fields
    const updateData = {};
    const allowedFields = ['title', 'content', 'priority', 'expiresAt'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (['title', 'content'].includes(field)) {
          updateData[field] = req.body[field].trim();
        } else {
          updateData[field] = req.body[field];
        }
      }
    });

    const updatedNotice = await Notice.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('postedBy', 'fullName email')
     .populate('department', 'name code')
     .populate('groups', 'name code');

    res.json({
      success: true,
      message: 'Notice updated successfully',
      data: updatedNotice
    });
  } catch (error) {
    console.error('Update notice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notice'
    });
  }
});

// DELETE /api/notices/:id - Delete notice
router.delete('/:id', idValidation, async (req, res) => {
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
    const user = await User.findById(req.user.id).populate('role');

    // Find notice and check access
    let notice;
    if (user.role.name === 'Admin') {
      notice = await Notice.findById(id);
    } else if (user.role.name === 'HOD') {
      notice = await Notice.findOne({
        _id: id,
        postedBy: user._id
      });
    } else if (user.role.name === 'Teacher') {
      notice = await Notice.findOne({
        _id: id,
        postedBy: user._id
      });
    }

    if (!notice) {
      return res.status(404).json({
        success: false,
        error: 'Notice not found or access denied'
      });
    }

    // Soft delete by setting isActive to false
    notice.isActive = false;
    await notice.save();

    res.json({
      success: true,
      message: 'Notice deleted successfully'
    });
  } catch (error) {
    console.error('Delete notice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete notice'
    });
  }
});

// POST /api/notices/:id/mark-read - Mark notice as read
router.post('/:id/mark-read', idValidation, async (req, res) => {
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
    const notice = await Notice.findById(id);

    if (!notice) {
      return res.status(404).json({
        success: false,
        error: 'Notice not found'
      });
    }

    // Check if user has access to this notice
    const hasAccess = await notice.hasAccess(req.user.id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this notice'
      });
    }

    // Mark as read
    await notice.markAsRead(req.user.id);

    res.json({
      success: true,
      message: 'Notice marked as read',
      data: {
        readCount: notice.readCount,
        isRead: true
      }
    });
  } catch (error) {
    console.error('Mark notice as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notice as read'
    });
  }
});

// POST /api/notices/mark-all-read - Mark all notices as read for user
router.post('/mark-all-read', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('role');
    const notices = await Notice.findByUser(user._id, { limit: 1000 });

    // Mark all notices as read
    const markPromises = notices.map(notice =>
      notice.markAsRead(user._id).catch(err => {
        console.error('Failed to mark notice as read:', err);
        return null;
      })
    );

    await Promise.all(markPromises);
    const markedCount = markPromises.filter(p => p !== null).length;

    res.json({
      success: true,
      message: `Marked ${markedCount} notices as read`,
      data: {
        markedCount
      }
    });
  } catch (error) {
    console.error('Mark all notices as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark all notices as read'
    });
  }
});

// GET /api/notices/unread-count - Get unread notice count for user
router.get('/unread-count', async (req, res) => {
  try {
    const unreadCount = await Notice.getUnreadCount(req.user.id);

    res.json({
      success: true,
      data: {
        unreadCount
      }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get unread notice count'
    });
  }
});

// GET /api/notices/department/:id - Get notices for specific department
router.get('/department/:id', idValidation, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
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
    const { page = 1, limit = 10 } = req.query;

    const user = await User.findById(req.user.id).populate('role');

    // Check access permissions
    let hasAccess = false;
    if (user.role.name === 'Admin') {
      hasAccess = true;
    } else if (user.role.name === 'HOD' && user.department?.toString() === id) {
      hasAccess = true;
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to department notices'
      });
    }

    const notices = await Notice.findByDepartment(id, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    const total = await Notice.countDocuments({
      $or: [
        { targetType: 'all' },
        { targetType: 'department', department: id }
      ],
      isActive: true
    });

    res.json({
      success: true,
      data: notices,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get department notices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch department notices'
    });
  }
});

// GET /api/notices/group/:id - Get notices for specific group
router.get('/group/:id', idValidation, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
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
    const { page = 1, limit = 10 } = req.query;

    const user = await User.findById(req.user.id).populate('role');

    // Check access permissions
    let hasAccess = false;
    if (user.role.name === 'Admin') {
      hasAccess = true;
    } else if (user.role.name === 'HOD') {
      const group = await Group.findOne({ _id: id, department: user.department });
      hasAccess = !!group;
    } else if (user.role.name === 'Teacher') {
      const group = await Group.findOne({ _id: id, teacher: user._id });
      hasAccess = !!group;
    } else if (user.role.name === 'Student') {
      hasAccess = user.groups.includes(id);
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to group notices'
      });
    }

    const notices = await Notice.findByGroup(id, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    const total = await Notice.countDocuments({
      $or: [
        { targetType: 'all' },
        { targetType: 'group', groups: id }
      ],
      isActive: true
    });

    res.json({
      success: true,
      data: notices,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get group notices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch group notices'
    });
  }
});

// GET /api/notices/stats - Get notice statistics
router.get('/stats', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const totalNotices = await Notice.countDocuments({ isActive: true });
    const expiredNotices = await Notice.countDocuments({
      isActive: true,
      expiresAt: { $lt: new Date() }
    });

    const activeNotices = totalNotices - expiredNotices;

    // Priority breakdown
    const priorityStats = await Notice.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Target type breakdown
    const targetTypeStats = await Notice.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$targetType', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Recent notices
    const recentNotices = await Notice.find({ isActive: true })
      .populate('postedBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(10)
      .select('title priority postedBy createdAt readCount');

    // Most read notices
    const mostReadNotices = await Notice.find({ isActive: true })
      .sort({ readCount: -1 })
      .limit(10)
      .select('title priority readCount createdAt');

    res.json({
      success: true,
      data: {
        overview: {
          totalNotices,
          activeNotices,
          expiredNotices
        },
        priorityBreakdown: priorityStats,
        targetTypeBreakdown: targetTypeStats,
        recentNotices,
        mostReadNotices
      }
    });
  } catch (error) {
    console.error('Get notice stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notice statistics'
    });
  }
});

// POST /api/notices/cleanup-expired - Clean up expired notices (admin only)
router.post('/cleanup-expired', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const result = await Notice.cleanupExpiredNotices();

    res.json({
      success: true,
      message: 'Expired notices cleaned up successfully',
      data: {
        deactivatedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('Cleanup expired notices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup expired notices'
    });
  }
});

module.exports = router;