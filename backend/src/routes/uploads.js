const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { randomBytes } = require('crypto');
const { body, validationResult } = require('express-validator');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { User, Note } = require('../models');

const router = express.Router();

// All upload routes require authentication
router.use(requireAuth);

// Create uploads directory if it doesn't exist
const ensureUploadsDirectory = async () => {
  const uploadsDir = path.join(__dirname, '../../uploads');
  try {
    await fs.access(uploadsDir);
  } catch {
    await fs.mkdir(uploadsDir, { recursive: true });
  }

  // Create subdirectories
  const subdirs = ['profile-photos', 'notes', 'temp'];
  for (const subdir of subdirs) {
    const subdirPath = path.join(uploadsDir, subdir);
    try {
      await fs.access(subdirPath);
    } catch {
      await fs.mkdir(subdirPath, { recursive: true });
    }
  }
};

// Initialize uploads directory
ensureUploadsDirectory();

// File type validation
const fileTypes = {
  'image/jpeg': true,
  'image/jpg': true,
  'image/png': true,
  'image/gif': true,
  'image/webp': true,
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'text/plain': true,
  'text/csv': true,
  'application/vnd.ms-excel': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/vnd.ms-powerpoint': true,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': true
};

// Check if file type is allowed
const isFileTypeAllowed = (mimetype) => {
  return fileTypes[mimetype] || false;
};

// Generate unique filename
const generateUniqueFilename = (originalname) => {
  const ext = path.extname(originalname);
  const name = path.basename(originalname, ext);
  const timestamp = Date.now();
  const uuid = randomBytes(4).toString('hex');
  return `${name}_${timestamp}_${uuid}${ext}`;
};

// Multer configuration for profile photos
const profilePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/profile-photos'));
  },
  filename: (req, file, cb) => {
    const uniqueFilename = generateUniqueFilename(file.originalname);
    cb(null, uniqueFilename);
  }
});

const profilePhotoUpload = multer({
  storage: profilePhotoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (!isFileTypeAllowed(file.mimetype)) {
      return cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed'), false);
    }
    cb(null, true);
  }
});

// Multer configuration for notes
const noteStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/notes'));
  },
  filename: (req, file, cb) => {
    const uniqueFilename = generateUniqueFilename(file.originalname);
    cb(null, uniqueFilename);
  }
});

const noteUpload = multer({
  storage: noteStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5 // Allow up to 5 files in a single upload
  },
  fileFilter: (req, file, cb) => {
    if (!isFileTypeAllowed(file.mimetype)) {
      return cb(new Error('Only document files (pdf, doc, docx, txt, csv, xls, xlsx, ppt, pptx) and images are allowed'), false);
    }
    cb(null, true);
  }
});

// Helper function to delete a file
const deleteFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.error('Failed to delete file:', error);
  }
};

// POST /api/uploads/profile-photo - Upload profile photo
router.post('/profile-photo', profilePhotoUpload.single('photo'), [
  body('userId').optional().isMongoId().withMessage('Invalid user ID')
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

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const userId = req.body.userId || req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      // Clean up uploaded file
      await deleteFile(req.file.path);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check permissions (users can only upload their own photo, admins can upload any)
    if (req.user.role.name !== 'Admin' && req.user.id !== userId) {
      // Clean up uploaded file
      await deleteFile(req.file.path);
      return res.status(403).json({
        success: false,
        error: 'You can only upload your own profile photo'
      });
    }

    // Delete old profile photo if it exists and is not the default
    if (user.profilePhoto && !user.profilePhoto.includes('default-avatar')) {
      const oldPhotoPath = path.join(__dirname, '../../uploads', user.profilePhoto);
      await deleteFile(oldPhotoPath);
    }

    // Update user's profile photo
    const photoUrl = `/uploads/profile-photos/${req.file.filename}`;
    user.profilePhoto = photoUrl;
    await user.save();

    res.json({
      success: true,
      message: 'Profile photo uploaded successfully',
      data: {
        profilePhoto: photoUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('Profile photo upload error:', error);

    // Clean up uploaded file if error occurred
    if (req.file) {
      await deleteFile(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to upload profile photo'
    });
  }
});

// DELETE /api/uploads/profile-photo - Delete profile photo
router.delete('/profile-photo', [
  body('userId').optional().isMongoId().withMessage('Invalid user ID')
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

    const userId = req.body.userId || req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check permissions
    if (req.user.role.name !== 'Admin' && req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own profile photo'
      });
    }

    // Delete current profile photo if it exists and is not the default
    if (user.profilePhoto && !user.profilePhoto.includes('default-avatar')) {
      const photoPath = path.join(__dirname, '../../uploads', user.profilePhoto);
      await deleteFile(photoPath);
    }

    // Reset to default profile photo
    user.profilePhoto = '/uploads/profile-photos/default-avatar.png';
    await user.save();

    res.json({
      success: true,
      message: 'Profile photo deleted successfully',
      data: {
        profilePhoto: user.profilePhoto
      }
    });
  } catch (error) {
    console.error('Profile photo deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete profile photo'
    });
  }
});

// POST /api/uploads/note - Upload study material note
router.post('/note', requirePermission('manage_notes'), noteUpload.array('files', 5), [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Note title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('description')
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
  body('modules')
    .optional()
    .isArray()
    .withMessage('Modules must be an array'),
  body('modules.*')
    .optional()
    .isMongoId()
    .withMessage('Invalid module ID'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Each tag cannot exceed 50 characters'),
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be boolean'),
  body('allowedRoles')
    .optional()
    .isArray()
    .withMessage('Allowed roles must be an array')
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

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const {
      title,
      description,
      department,
      groups = [],
      modules = [],
      tags = [],
      isPublic = false,
      allowedRoles = []
    } = req.body;

    // Validate department
    const { Department, Group, Module } = require('../models');
    const departmentDoc = await Department.findById(department);
    if (!departmentDoc || !departmentDoc.isActive) {
      // Clean up uploaded files
      for (const file of req.files) {
        await deleteFile(file.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Department not found or inactive'
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
        // Clean up uploaded files
        for (const file of req.files) {
          await deleteFile(file.path);
        }
        return res.status(400).json({
          success: false,
          error: 'Some groups are invalid or belong to different department'
        });
      }
    }

    // Validate modules if provided
    if (modules.length > 0) {
      const validModules = await Module.find({
        _id: { $in: modules },
        department: department,
        isActive: true
      });

      if (validModules.length !== modules.length) {
        // Clean up uploaded files
        for (const file of req.files) {
          await deleteFile(file.path);
        }
        return res.status(400).json({
          success: false,
          error: 'Some modules are invalid or belong to different department'
        });
      }
    }

    // Create notes for each uploaded file
    const createdNotes = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const note = new Note({
          title: title.trim(),
          description: description.trim(),
          department,
          groups,
          modules,
          uploadedBy: req.user.id,
          fileName: file.filename,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          filePath: `/uploads/notes/${file.filename}`,
          isPublic,
          allowedRoles,
          tags: tags.map(tag => tag.trim().toLowerCase())
        });

        await note.save();
        createdNotes.push(note);
      } catch (error) {
        console.error('Error creating note for file:', file.originalname, error);
        errors.push({
          file: file.originalname,
          error: error.message
        });
        // Clean up the failed file
        await deleteFile(file.path);
      }
    }

    if (createdNotes.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create any notes',
        details: errors
      });
    }

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${createdNotes.length} file(s)`,
      data: {
        uploaded: createdNotes.map(note => ({
          _id: note._id,
          title: note.title,
          fileName: note.fileName,
          originalName: note.originalName,
          fileSize: note.fileSize,
          mimeType: note.mimeType,
          filePath: note.filePath,
          tags: note.tags,
          isPublic: note.isPublic
        })),
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    console.error('Note upload error:', error);

    // Clean up all uploaded files if error occurred
    if (req.files) {
      for (const file of req.files) {
        await deleteFile(file.path);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Failed to upload notes'
    });
  }
});

// GET /api/uploads/notes/:fileId - Download note file
router.get('/notes/:fileId', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { fileId } = req.params;
    const note = await Note.findById(fileId);

    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'Note not found'
      });
    }

    // Check access permissions
    const user = await User.findById(req.user.id).populate('role');
    let hasAccess = false;

    if (user.role.name === 'Admin') {
      hasAccess = true;
    } else if (user.role.name === 'HOD' && user.department?.toString() === note.department?.toString()) {
      hasAccess = true;
    } else if (user.role.name === 'Teacher') {
      // Teacher can access if they're assigned to the same groups
      hasAccess = note.groups.some(group => user.groups.includes(group.toString()));
    } else if (user.role.name === 'Student') {
      // Student can access if note is public or they're in allowed groups/roles
      hasAccess = note.isPublic ||
        note.groups.some(group => user.groups.includes(group.toString())) ||
        note.allowedRoles.includes(user.role.name);
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this note'
      });
    }

    // Check if file exists
    const filePath = path.join(__dirname, '../../uploads/notes', note.fileName);
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'File not found on server'
      });
    }

    // Set appropriate headers for file download
    res.setHeader('Content-Type', note.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${note.originalName}"`);
    res.setHeader('Content-Length', note.fileSize);

    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Note download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download note'
    });
  }
});

// DELETE /api/uploads/notes/:fileId - Delete note file
router.delete('/notes/:fileId', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { fileId } = req.params;
    const note = await Note.findById(fileId);

    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'Note not found'
      });
    }

    // Check if user can delete this note
    const user = await User.findById(req.user.id).populate('role');
    let canDelete = false;

    if (user.role.name === 'Admin') {
      canDelete = true;
    } else if (user.role.name === 'HOD' && user.department?.toString() === note.department?.toString()) {
      canDelete = true;
    } else if (user.role.name === 'Teacher' && note.uploadedBy.toString() === user._id.toString()) {
      canDelete = true;
    }

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own uploaded notes'
      });
    }

    // Delete the physical file
    const filePath = path.join(__dirname, '../../uploads/notes', note.fileName);
    await deleteFile(filePath);

    // Delete the note record
    await Note.findByIdAndDelete(fileId);

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    console.error('Note deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete note'
    });
  }
});

// GET /api/uploads/stats - Get upload statistics
router.get('/stats', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const totalNotes = await Note.countDocuments({ isActive: true });
    const publicNotes = await Note.countDocuments({ isActive: true, isPublic: true });
    const privateNotes = totalNotes - publicNotes;

    // File type distribution
    const fileTypeStats = await Note.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$mimeType', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Storage usage
    const storageStats = await Note.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalSize: { $sum: '$fileSize' },
          count: { $sum: 1 }
        }
      }
    ]);

    const totalStorage = storageStats[0]?.totalSize || 0;
    const totalFiles = storageStats[0]?.count || 0;
    const averageFileSize = totalFiles > 0 ? totalStorage / totalFiles : 0;

    // Recent uploads
    const recentUploads = await Note.find({ isActive: true })
      .populate('uploadedBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(10)
      .select('title originalName fileSize uploadedBy createdAt');

    res.json({
      success: true,
      data: {
        overview: {
          totalNotes,
          publicNotes,
          privateNotes,
          totalFiles,
          totalStorage,
          averageFileSize
        },
        fileTypeDistribution: fileTypeStats,
        recentUploads
      }
    });
  } catch (error) {
    console.error('Get upload stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch upload statistics'
    });
  }
});

// GET /api/uploads/health - Check upload system health
router.get('/health', requireAuth, async (req, res) => {
  try {
    const uploadsDir = path.join(__dirname, '../../uploads');

    // Check if uploads directory exists and is writable
    try {
      await fs.access(uploadsDir, fs.constants.W_OK);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Uploads directory is not writable',
        details: error.message
      });
    }

    // Check available disk space
    const stats = await fs.statvfs(uploadsDir);
    const availableSpace = stats.bavail * stats.bsize;
    const totalSpace = stats.blocks * stats.bsize;
    const usedSpace = totalSpace - availableSpace;

    res.json({
      success: true,
      data: {
        status: 'healthy',
        directory: uploadsDir,
        diskSpace: {
          total: totalSpace,
          used: usedSpace,
          available: availableSpace,
          usedPercentage: ((usedSpace / totalSpace) * 100).toFixed(2)
        }
      }
    });
  } catch (error) {
    console.error('Upload health check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check upload system health'
    });
  }
});

module.exports = router;