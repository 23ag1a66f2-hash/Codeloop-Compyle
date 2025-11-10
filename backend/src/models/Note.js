const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Note title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  modules: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Module'
  }],
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Uploader is required']
  },

  // File details
  fileName: {
    type: String,
    required: [true, 'File name is required'],
    trim: true
  },
  originalName: {
    type: String,
    required: [true, 'Original file name is required'],
    trim: true
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required'],
    min: [1, 'File size must be at least 1 byte']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required']
  },
  filePath: {
    type: String,
    required: [true, 'File path is required']
  },
  fileUrl: {
    type: String
  },

  // Access control
  isPublic: {
    type: Boolean,
    default: false
  },
  allowedRoles: [{
    type: String,
    enum: ['Admin', 'HOD', 'Teacher', 'Student']
  }],

  // Content metadata
  category: {
    type: String,
    enum: ['lecture', 'tutorial', 'assignment', 'reference', 'solution', 'other'],
    default: 'other'
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],

  isActive: {
    type: Boolean,
    default: true
  },
  downloadCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
noteSchema.index({ title: 1 });
noteSchema.index({ uploadedBy: 1 });
noteSchema.index({ department: 1 });
noteSchema.index({ groups: 1 });
noteSchema.index({ modules: 1 });
noteSchema.index({ isPublic: 1 });
noteSchema.index({ category: 1 });
noteSchema.index({ tags: 1 });
noteSchema.index({ isActive: 1 });

// Virtual for formatted file size
noteSchema.virtual('formattedFileSize').get(function() {
  const bytes = this.fileSize;
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Virtual for file extension
noteSchema.virtual('fileExtension').get(function() {
  const parts = this.originalName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
});

// Static method to find notes by user access
noteSchema.statics.findByUserAccess = function(userId, options = {}) {
  const { page = 1, limit = 10, category = null, search = '' } = options;
  const User = mongoose.model('User');

  return User.findById(userId)
    .then(user => {
      const query = {
        isActive: true,
        $or: [
          { uploadedBy: userId },
          { isPublic: true },
          { department: user.department },
          { groups: { $in: user.groups } },
          { allowedRoles: { $in: [user.role] } }
        ]
      };

      if (category) query.category = category;
      if (search) {
        query.$and = [
          {
            $or: [
              { title: { $regex: search, $options: 'i' } },
              { description: { $regex: search, $options: 'i' } },
              { tags: { $in: [new RegExp(search, 'i')] } }
            ]
          }
        ];
      }

      return this.find(query)
        .populate('uploadedBy', 'fullName')
        .populate('department', 'name code')
        .populate('groups', 'name code')
        .populate('modules', 'title')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
    });
};

// Static method to find notes by module
noteSchema.statics.findByModule = function(moduleId, options = {}) {
  const { page = 1, limit = 10 } = options;

  return this.find({
    modules: moduleId,
    isActive: true
  })
    .populate('uploadedBy', 'fullName')
    .populate('modules', 'title')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
};

// Static method to find notes by department
noteSchema.statics.findByDepartment = function(departmentId, options = {}) {
  const { page = 1, limit = 10, category = null } = options;

  const query = {
    department: departmentId,
    isActive: true
  };
  if (category) query.category = category;

  return this.find(query)
    .populate('uploadedBy', 'fullName')
    .populate('department', 'name code')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
};

// Instance method to increment download count
noteSchema.methods.incrementDownloadCount = function() {
  this.downloadCount += 1;
  return this.save();
};

// Instance method to check access for user
noteSchema.methods.hasAccess = async function(userId) {
  const User = mongoose.model('User');
  const user = await User.findById(userId).populate('role');

  // Owner has access
  if (this.uploadedBy.toString() === userId) {
    return true;
  }

  // Public notes are accessible to everyone
  if (this.isPublic) {
    return true;
  }

  // Department-based access
  if (this.department && user.department && this.department.toString() === user.department.toString()) {
    return true;
  }

  // Group-based access
  const hasGroupAccess = this.groups.some(groupId =>
    user.groups.some(userGroupId => userGroupId.toString() === groupId.toString())
  );
  if (hasGroupAccess) {
    return true;
  }

  // Role-based access
  if (this.allowedRoles.includes(user.role.name)) {
    return true;
  }

  return false;
};

// Pre-save middleware to validate uploader permissions
noteSchema.pre('save', async function(next) {
  if (this.isNew && this.uploadedBy) {
    const User = mongoose.model('User');
    const uploader = await User.findById(this.uploadedBy);

    if (!uploader) {
      const error = new Error('Uploader not found');
      return next(error);
    }

    // Check if uploader has permission to upload notes
    const hasPermission = await uploader.hasPermission('manage_notes');
    if (!hasPermission) {
      const error = new Error('User does not have permission to upload notes');
      return next(error);
    }
  }
  next();
});

module.exports = mongoose.model('Note', noteSchema);