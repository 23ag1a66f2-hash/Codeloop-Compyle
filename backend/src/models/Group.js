const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Group name is required'],
    trim: true,
    maxlength: [100, 'Group name cannot exceed 100 characters']
  },
  code: {
    type: String,
    required: [true, 'Group code is required'],
    unique: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z0-9]{2,10}$/, 'Group code must be 2-10 alphanumeric characters']
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: [true, 'Department is required']
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher is required']
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  maxCapacity: {
    type: Number,
    default: 50,
    min: [1, 'Maximum capacity must be at least 1'],
    max: [200, 'Maximum capacity cannot exceed 200']
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
groupSchema.index({ code: 1 });
groupSchema.index({ department: 1 });
groupSchema.index({ teacher: 1 });
groupSchema.index({ name: 1, department: 1 });

// Virtual for student count
groupSchema.virtual('studentCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'groups',
  count: true
});

// Virtual for modules assigned to this group
groupSchema.virtual('modules', {
  ref: 'Module',
  localField: '_id',
  foreignField: 'groups'
});

// Virtual for assessments assigned to this group
groupSchema.virtual('assessments', {
  ref: 'Assessment',
  localField: '_id',
  foreignField: 'groups'
});

// Instance method to add student
groupSchema.methods.addStudent = function(userId) {
  if (!this.students.includes(userId)) {
    if (this.students.length >= this.maxCapacity) {
      throw new Error(`Group has reached maximum capacity of ${this.maxCapacity} students`);
    }
    this.students.push(userId);
  }
  return this.save();
};

// Instance method to remove student
groupSchema.methods.removeStudent = function(userId) {
  this.students = this.students.filter(id => !id.equals(userId));
  return this.save();
};

// Instance method to check if group is at capacity
groupSchema.methods.isAtCapacity = function() {
  return this.students.length >= this.maxCapacity;
};

// Instance method to get available slots
groupSchema.methods.getAvailableSlots = function() {
  return Math.max(0, this.maxCapacity - this.students.length);
};

// Static method to find groups by teacher
groupSchema.statics.findByTeacher = function(teacherId) {
  return this.find({ teacher: teacherId, isActive: true })
    .populate('department', 'name code')
    .populate('studentCount');
};

// Static method to find groups by department
groupSchema.statics.findByDepartment = function(departmentId) {
  return this.find({ department: departmentId, isActive: true })
    .populate('teacher', 'fullName email')
    .populate('studentCount');
};

// Static method to get group with full details
groupSchema.statics.getWithDetails = function(groupId) {
  return this.findById(groupId)
    .populate('department', 'name code')
    .populate('teacher', 'fullName email')
    .populate({
      path: 'students',
      select: 'fullName email profilePhoto lastLogin'
    })
    .populate('modules', 'title description createdAt')
    .populate('studentCount');
};

// Pre-save middleware to validate teacher
groupSchema.pre('save', async function(next) {
  if (this.teacher) {
    const User = mongoose.model('User');
    const teacherUser = await User.findById(this.teacher).populate('role');

    if (!teacherUser || (teacherUser.role.name !== 'Teacher' && teacherUser.role.name !== 'HOD')) {
      const error = new Error('Group must be assigned to a Teacher or HOD');
      return next(error);
    }

    // Check if teacher belongs to the same department
    if (teacherUser.department && !teacherUser.department.equals(this.department)) {
      const error = new Error('Teacher must belong to the same department as the group');
      return next(error);
    }
  }
  next();
});

// Pre-save middleware to validate department
groupSchema.pre('save', async function(next) {
  if (this.isNew && this.department) {
    const Department = mongoose.model('Department');
    const department = await Department.findById(this.department);

    if (!department || !department.isActive) {
      const error = new Error('Department must exist and be active');
      return next(error);
    }
  }
  next();
});

// Pre-remove middleware to clean up references
groupSchema.pre('remove', async function(next) {
  const User = mongoose.model('User');
  const Module = mongoose.model('Module');
  const Assessment = mongoose.model('Assessment');

  // Remove group reference from all users
  await User.updateMany(
    { groups: this._id },
    { $pull: { groups: this._id } }
  );

  // Remove group from all modules
  await Module.updateMany(
    { groups: this._id },
    { $pull: { groups: this._id } }
  );

  // Remove group from all assessments
  await Assessment.updateMany(
    { groups: this._id },
    { $pull: { groups: this._id } }
  );

  next();
});

module.exports = mongoose.model('Group', groupSchema);