const authService = require('../services/authService');
const { User } = require('../models');

// Basic authentication middleware
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = authService.verifyAccessToken(token);

    // Get user with populated role and permissions
    const user = await User.findById(decoded.id)
      .populate('role')
      .populate('customPermissions');

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token or user not found.'
      });
    }

    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid token.'
    });
  }
};

// Role-based authorization middleware
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    const userRole = req.user.role?.name;

    if (!userRole) {
      return res.status(403).json({
        success: false,
        error: 'User role not found.'
      });
    }

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions. Required role: ' + roles.join(' or ')
      });
    }

    next();
  };
};

// Permission-based authorization middleware
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required.'
        });
      }

      const hasPermission = await authService.checkPermission(req.user._id, permission);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions. Required permission: ' + permission
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Permission check failed.'
      });
    }
  };
};

// Role hierarchy check middleware (higher roles can access lower role resources)
const requireRoleHierarchy = (minimumRole) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required.'
        });
      }

      const userHierarchy = await authService.getUserRoleHierarchy(req.user._id);

      if (!userHierarchy) {
        return res.status(403).json({
          success: false,
          error: 'User role hierarchy not found.'
        });
      }

      // Role hierarchy: Admin=1, HOD=2, Teacher=3, Student=4
      // Lower numbers have higher privileges
      const roleHierarchyMap = {
        'Admin': 1,
        'HOD': 2,
        'Teacher': 3,
        'Student': 4
      };

      const minimumHierarchy = roleHierarchyMap[minimumRole];
      const userHierarchyNum = roleHierarchyMap[req.user.role?.name];

      if (userHierarchyNum > minimumHierarchy) {
        return res.status(403).json({
          success: false,
          error: `Insufficient role privileges. Required: ${minimumRole} or higher`
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Role hierarchy check failed.'
      });
    }
  };
};

// Department scope middleware (users can only access their own department resources)
const departmentScope = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    // Admin can access all departments
    if (req.user.role?.name === 'Admin') {
      return next();
    }

    // Get department ID from request parameters or body
    const departmentId = req.params.departmentId ||
                       req.body.department ||
                       req.query.department;

    if (departmentId) {
      // Check if user belongs to the requested department
      if (!req.user.department || req.user.department.toString() !== departmentId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. You can only access your own department resources.'
        });
      }
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Department scope check failed.'
    });
  }
};

// Group scope middleware (users can only access resources from their assigned groups)
const groupScope = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    // Admin can access all groups
    if (req.user.role?.name === 'Admin') {
      return next();
    }

    // HOD can access all groups in their department
    if (req.user.role?.name === 'HOD') {
      // Group scope for HOD is handled by department scope middleware
      return next();
    }

    // Get group ID from request parameters or body
    const groupId = req.params.groupId ||
                   req.params.id ||  // For /api/groups/:id routes
                   req.body.group ||
                   req.body.groups;  // For arrays

    if (groupId) {
      // Handle single group or array of groups
      const groupIds = Array.isArray(groupId) ? groupId : [groupId];

      // Check if user has access to any of the requested groups
      const userGroupIds = req.user.groups.map(g => g.toString());
      const hasAccess = groupIds.some(id =>
        userGroupIds.includes(id.toString())
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. You can only access resources from your assigned groups.'
        });
      }
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Group scope check failed.'
    });
  }
};

// Resource ownership middleware (users can only access their own resources)
const requireOwnership = (resourceModel, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required.'
        });
      }

      // Admin can access all resources
      if (req.user.role?.name === 'Admin') {
        return next();
      }

      const resourceId = req.params[resourceIdParam];
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          error: 'Resource ID not provided.'
        });
      }

      const Resource = require('../models')[resourceModel];
      const resource = await Resource.findById(resourceId);

      if (!resource) {
        return res.status(404).json({
          success: false,
          error: 'Resource not found.'
        });
      }

      // Check ownership based on different models
      let isOwner = false;

      switch (resourceModel) {
        case 'Module':
        case 'Question':
        case 'Assessment':
        case 'Note':
        case 'Notice':
          isOwner = resource.createdBy &&
                   resource.createdBy.toString() === req.user._id.toString();
          break;

        case 'AssessmentSubmission':
          isOwner = resource.student &&
                   resource.student.toString() === req.user._id.toString();
          break;

        case 'PerformanceMetric':
          isOwner = resource.student &&
                   resource.student.toString() === req.user._id.toString();
          break;

        default:
          isOwner = false;
      }

      // For department-level resources, also check department access
      if (!isOwner && resource.department && req.user.department) {
        isOwner = resource.department.toString() === req.user.department.toString() &&
                  ['HOD', 'Teacher'].includes(req.user.role?.name);
      }

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. You can only access your own resources.'
        });
      }

      req.resource = resource;
      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Ownership check failed.'
      });
    }
  };
};

// Email verification middleware
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }

  if (!req.user.isEmailVerified) {
    return res.status(403).json({
      success: false,
      error: 'Email verification required. Please verify your email address.'
    });
  }

  next();
};

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = authService.verifyAccessToken(token);

      const user = await User.findById(decoded.id)
        .populate('role')
        .populate('customPermissions');

      if (user && user.isActive) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

module.exports = {
  requireAuth,
  requireRole,
  requirePermission,
  requireRoleHierarchy,
  departmentScope,
  groupScope,
  requireOwnership,
  requireEmailVerification,
  optionalAuth
};