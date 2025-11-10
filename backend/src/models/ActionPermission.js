const mongoose = require('mongoose');

const actionPermissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Permission name is required'],
    unique: true,
    trim: true,
    lowercase: true
  },
  description: {
    type: String,
    required: [true, 'Permission description is required'],
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  category: {
    type: String,
    required: [true, 'Permission category is required'],
    enum: {
      values: ['admin', 'academic', 'assessment', 'content', 'analytics'],
      message: 'Category must be one of: admin, academic, assessment, content, analytics'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
actionPermissionSchema.index({ name: 1 });
actionPermissionSchema.index({ category: 1 });

// Static method to create default permissions
actionPermissionSchema.statics.createDefaultPermissions = async function() {
  const defaultPermissions = [
    // Admin permissions
    { name: 'manage_users', description: 'Create, edit, and delete users', category: 'admin' },
    { name: 'manage_departments', description: 'Create, edit, and delete departments', category: 'admin' },
    { name: 'manage_roles', description: 'Manage system roles and permissions', category: 'admin' },
    { name: 'manage_system_settings', description: 'Configure system-wide settings', category: 'admin' },
    { name: 'view_system_analytics', description: 'Access system-wide analytics and reports', category: 'admin' },
    { name: 'bulk_operations', description: 'Perform bulk upload operations', category: 'admin' },

    // Academic permissions
    { name: 'manage_groups', description: 'Create and manage student groups', category: 'academic' },
    { name: 'assign_teachers', description: 'Assign teachers to groups and modules', category: 'academic' },
    { name: 'manage_modules', description: 'Create, edit, and delete learning modules', category: 'academic' },
    { name: 'view_modules', description: 'View assigned learning modules', category: 'academic' },
    { name: 'manage_notes', description: 'Upload and manage study materials', category: 'academic' },

    // Assessment permissions
    { name: 'manage_assessments', description: 'Create and manage assessments', category: 'assessment' },
    { name: 'manage_questions', description: 'Create and edit assessment questions', category: 'assessment' },
    { name: 'attempt_assessments', description: 'Take assigned assessments', category: 'assessment' },
    { name: 'view_assessment_results', description: 'View assessment results and analytics', category: 'assessment' },
    { name: 'grade_submissions', description: 'Grade and evaluate student submissions', category: 'assessment' },

    // Content permissions
    { name: 'submit_code', description: 'Submit code solutions for practice', category: 'content' },
    { name: 'view_leaderboard', description: 'View performance leaderboards', category: 'content' },
    { name: 'post_notices', description: 'Create and post notices', category: 'content' },
    { name: 'manage_files', description: 'Upload and manage files', category: 'content' },

    // Analytics permissions
    { name: 'view_analytics', description: 'View performance analytics', category: 'analytics' },
    { name: 'export_reports', description: 'Export analytics and reports', category: 'analytics' },
    { name: 'view_performance', description: 'View student performance data', category: 'analytics' }
  ];

  try {
    // Insert permissions if they don't exist
    for (const permissionData of defaultPermissions) {
      await this.findOneAndUpdate(
        { name: permissionData.name },
        permissionData,
        { upsert: true, new: true }
      );
    }
    console.log('Default permissions created successfully');
  } catch (error) {
    console.error('Error creating default permissions:', error);
  }
};

// Static method to get permissions by category
actionPermissionSchema.statics.getByCategory = function(category) {
  return this.find({ category, isActive: true }).sort({ name: 1 });
};

// Static method to get all active permissions
actionPermissionSchema.statics.getAllActive = function() {
  return this.find({ isActive: true }).sort({ category: 1, name: 1 });
};

module.exports = mongoose.model('ActionPermission', actionPermissionSchema);