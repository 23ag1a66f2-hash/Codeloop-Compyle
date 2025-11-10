const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Department name is required'],
    unique: true,
    trim: true,
    maxlength: [100, 'Department name cannot exceed 100 characters']
  },
  code: {
    type: String,
    required: [true, 'Department code is required'],
    unique: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{2,6}$/, 'Department code must be 2-6 uppercase letters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  hod: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  teachers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
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
departmentSchema.index({ name: 1 });
departmentSchema.index({ code: 1 });
departmentSchema.index({ hod: 1 });

// Virtual for department statistics
departmentSchema.virtual('teacherCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'department',
  count: true,
  match: { role: 'Teacher' }
});

departmentSchema.virtual('studentCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'department',
  count: true,
  match: { role: 'Student' }
});

departmentSchema.virtual('groupCount', {
  ref: 'Group',
  localField: '_id',
  foreignField: 'department',
  count: true
});

departmentSchema.virtual('moduleCount', {
  ref: 'Module',
  localField: '_id',
  foreignField: 'department',
  count: true
});

// Virtual for groups in this department
departmentSchema.virtual('groups', {
  ref: 'Group',
  localField: '_id',
  foreignField: 'department'
});

// Virtual for modules in this department
departmentSchema.virtual('modules', {
  ref: 'Module',
  localField: '_id',
  foreignField: 'department'
});

// Instance method to add teacher to department
departmentSchema.methods.addTeacher = function(userId) {
  if (!this.teachers.includes(userId)) {
    this.teachers.push(userId);
  }
  return this.save();
};

// Instance method to remove teacher from department
departmentSchema.methods.removeTeacher = function(userId) {
  this.teachers = this.teachers.filter(id => !id.equals(userId));
  return this.save();
};

// Instance method to add student to department
departmentSchema.methods.addStudent = function(userId) {
  if (!this.students.includes(userId)) {
    this.students.push(userId);
  }
  return this.save();
};

// Instance method to remove student from department
departmentSchema.methods.removeStudent = function(userId) {
  this.students = this.students.filter(id => !id.equals(userId));
  return this.save();
};

// Instance method to set HOD
departmentSchema.methods.setHOD = async function(userId) {
  const User = mongoose.model('User');

  // Remove current HOD if exists
  if (this.hod) {
    await User.findByIdAndUpdate(this.hod, { $unset: { department: '' } });
  }

  // Set new HOD
  this.hod = userId;
  await User.findByIdAndUpdate(userId, {
    department: this._id,
    groups: []
  });

  return this.save();
};

// Static method to get department with statistics
departmentSchema.statics.getWithStats = function(departmentId) {
  return this.findById(departmentId)
    .populate('hod', 'fullName email')
    .populate({
      path: 'teachers',
      select: 'fullName email groups',
      populate: {
        path: 'groups',
        select: 'name code'
      }
    })
    .populate('teacherCount')
    .populate('studentCount')
    .populate('groupCount');
};

// Pre-save middleware to validate HOD
departmentSchema.pre('save', async function(next) {
  if (this.hod) {
    const User = mongoose.model('User');
    const hodUser = await User.findById(this.hod).populate('role');

    if (!hodUser || hodUser.role.name !== 'HOD') {
      const error = new Error('HOD must be a user with HOD role');
      return next(error);
    }
  }
  next();
});

// Pre-remove middleware to clean up references
departmentSchema.pre('remove', async function(next) {
  const User = mongoose.model('User');
  const Group = mongoose.model('Group');
  const Module = mongoose.model('Module');

  // Remove department reference from all users
  await User.updateMany(
    { department: this._id },
    { $unset: { department: '' } }
  );

  // Remove all groups in this department
  await Group.deleteMany({ department: this._id });

  // Remove all modules in this department
  await Module.deleteMany({ department: this._id });

  next();
});

module.exports = mongoose.model('Department', departmentSchema);