const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Role name is required'],
    unique: true,
    trim: true,
    enum: {
      values: ['Admin', 'HOD', 'Teacher', 'Student'],
      message: 'Role must be one of: Admin, HOD, Teacher, Student'
    }
  },
  permissions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActionPermission'
  }],
  hierarchy: {
    type: Number,
    required: [true, 'Hierarchy level is required'],
    min: 1,
    max: 4,
    default: function() {
      // Set default hierarchy based on role name
      const hierarchyMap = {
        'Admin': 1,
        'HOD': 2,
        'Teacher': 3,
        'Student': 4
      };
      return hierarchyMap[this.name] || 4;
    }
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
roleSchema.index({ name: 1 });
roleSchema.index({ hierarchy: 1 });

// Virtual for role statistics
roleSchema.virtual('userCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'role',
  count: true
});

// Static method to create default roles
roleSchema.statics.createDefaultRoles = async function() {
  const ActionPermission = mongoose.model('ActionPermission');

  // Get all permissions
  const permissions = await ActionPermission.find({});

  const defaultRoles = [
    {
      name: 'Admin',
      description: 'Full system access with all permissions',
      hierarchy: 1,
      permissions: permissions.map(p => p._id)
    },
    {
      name: 'HOD',
      description: 'Head of Department with department-level permissions',
      hierarchy: 2,
      permissions: permissions.filter(p =>
        p.category === 'academic' ||
        p.category === 'assessment' ||
        p.name === 'manage_groups'
      ).map(p => p._id)
    },
    {
      name: 'Teacher',
      description: 'Teacher with group and module management permissions',
      hierarchy: 3,
      permissions: permissions.filter(p =>
        p.name === 'manage_modules' ||
        p.name === 'manage_assessments' ||
        p.name === 'manage_notes' ||
        p.name === 'view_analytics'
      ).map(p => p._id)
    },
    {
      name: 'Student',
      description: 'Student with learning and assessment access',
      hierarchy: 4,
      permissions: permissions.filter(p =>
        p.name === 'view_modules' ||
        p.name === 'attempt_assessments' ||
        p.name === 'submit_code'
      ).map(p => p._id)
    }
  ];

  try {
    // Insert roles if they don't exist
    for (const roleData of defaultRoles) {
      await this.findOneAndUpdate(
        { name: roleData.name },
        roleData,
        { upsert: true, new: true }
      );
    }
    console.log('Default roles created successfully');
  } catch (error) {
    console.error('Error creating default roles:', error);
  }
};

// Pre-save middleware to ensure unique hierarchy
roleSchema.pre('save', async function(next) {
  if (!this.isNew) return next();

  // Check if hierarchy already exists
  const existingRole = await this.constructor.findOne({ hierarchy: this.hierarchy });
  if (existingRole) {
    const error = new Error(`Hierarchy level ${this.hierarchy} is already assigned to role '${existingRole.name}'`);
    return next(error);
  }
  next();
});

module.exports = mongoose.model('Role', roleSchema);