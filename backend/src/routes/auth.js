const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const authService = require('../services/authService');
const { User, Role, Department } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Validation rules
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),

  body('email')
    .isEmail()
    .withMessage('Please enter a valid email')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),

  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),

  body('role')
    .isIn(['Admin', 'HOD', 'Teacher', 'Student'])
    .withMessage('Role must be one of: Admin, HOD, Teacher, Student'),

  body('department')
    .optional()
    .isMongoId()
    .withMessage('Invalid department ID')
];

const loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),

  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number')
];

const forgotPasswordValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email')
    .normalizeEmail()
];

const resetPasswordValidation = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required'),

  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number')
];

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', registerValidation, handleValidationErrors, async (req, res) => {
  try {
    const { username, email, password, fullName, role, department } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: existingUser.email === email ? 'Email already registered' : 'Username already taken'
      });
    }

    // Validate role exists
    const roleDocument = await Role.findOne({ name: role });
    if (!roleDocument) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role'
      });
    }

    // Validate department exists (if provided)
    let departmentDoc = null;
    if (department) {
      departmentDoc = await Department.findById(department);
      if (!departmentDoc) {
        return res.status(400).json({
          success: false,
          error: 'Invalid department'
        });
      }
    }

    // For HOD role, department is required
    if (role === 'HOD' && !department) {
      return res.status(400).json({
        success: false,
        error: 'Department is required for HOD role'
      });
    }

    // Create new user
    const user = new User({
      username,
      email,
      password,
      fullName,
      role: roleDocument._id,
      department: departmentDoc?._id
    });

    // Generate email verification token
    const emailVerificationToken = authService.generateEmailVerificationToken();
    user.emailVerificationToken = emailVerificationToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await user.save();

    // Populate user data for response
    await user.populate('role');

    // Generate tokens
    const { accessToken, refreshToken } = authService.generateTokens({
      id: user._id,
      email: user.email,
      role: user.role
    });

    // Store refresh token
    await authService.generateAndStoreRefreshToken(user, req.get('User-Agent') || 'web');

    // TODO: Send verification email
    // await emailService.sendVerificationEmail(email, emailVerificationToken);

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please check your email for verification.',
      data: {
        user: user.fullProfile,
        accessToken,
        refreshToken,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', loginValidation, handleValidationErrors, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user with password
    const user = await User.findOne({ email })
      .select('+password')
      .populate('role');

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Check password
    const isPasswordCorrect = await user.correctPassword(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = authService.generateTokens({
      id: user._id,
      email: user.email,
      role: user.role
    });

    // Store refresh token
    await authService.generateAndStoreRefreshToken(user, req.get('User-Agent') || 'web');

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.fullProfile,
        accessToken,
        refreshToken,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// @route   POST /api/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    const { accessToken, refreshToken: newRefreshToken } = await authService.refreshToken(
      refreshToken,
      req.get('User-Agent') || 'web'
    );

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    await authService.logout(req.user._id, refreshToken);

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

// @route   POST /api/auth/logout-all
// @desc    Logout from all devices
// @access  Private
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    await authService.logoutAll(req.user._id);

    res.json({
      success: true,
      message: 'Logged out from all devices'
    });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout from all devices failed'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Get user with populated data
    const user = await User.findById(req.user._id)
      .populate('role')
      .populate('department')
      .populate('groups')
      .populate('customPermissions');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: user.fullProfile,
        permissions: user.customPermissions
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
});

// @route   POST /api/auth/change-password
// @desc    Change password
// @access  Private
router.post('/change-password', requireAuth, changePasswordValidation, handleValidationErrors, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    await authService.changePassword(req.user._id, currentPassword, newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Password change failed'
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', forgotPasswordValidation, handleValidationErrors, async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    }

    // Generate reset token
    const { resetToken, resetTokenHash } = authService.generatePasswordResetToken();

    // Save reset token to user
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // TODO: Send password reset email
    // await emailService.sendPasswordResetEmail(email, resetToken);

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset request failed'
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password', resetPasswordValidation, handleValidationErrors, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Verify reset token
    const user = await authService.verifyPasswordResetToken(token);

    // Update password
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Logout from all devices after password reset
    await authService.logoutAll(user._id);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Password reset failed'
    });
  }
});

// @route   GET /api/auth/verify-email/:token
// @desc    Verify email address
// @access  Public
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification token'
      });
    }

    // Mark email as verified
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Email verification failed'
    });
  }
});

// @route   GET /api/auth/sessions
// @desc    Get user's active sessions
// @access  Private
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await authService.getUserSessions(req.user._id);

    res.json({
      success: true,
      data: { sessions }
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sessions'
    });
  }
});

// @route   POST /api/auth/validate-token
// @desc    Validate access token
// @access  Private
router.post('/validate-token', requireAuth, (req, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    data: {
      user: req.user.fullProfile
    }
  });
});

module.exports = router;