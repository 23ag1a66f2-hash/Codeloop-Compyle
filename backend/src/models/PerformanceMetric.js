const mongoose = require('mongoose');

const questionStatSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question',
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  bestScore: {
    type: Number,
    default: 0
  },
  firstAttemptCorrect: {
    type: Boolean,
    default: false
  },
  lastAttemptedAt: {
    type: Date,
    default: null
  },
  averageTime: {
    type: Number,
    default: 0 // in seconds
  }
}, { _id: false });

const performanceMetricSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Student is required']
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: [true, 'Department is required']
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    required: [true, 'Group is required']
  },
  module: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Module'
  },

  // Practice statistics
  totalPracticeSubmissions: {
    type: Number,
    default: 0
  },
  acceptedSubmissions: {
    type: Number,
    default: 0
  },
  rejectedSubmissions: {
    type: Number,
    default: 0
  },
  practiceSuccessRate: {
    type: Number,
    default: 0
  },

  // Assessment statistics
  totalAssessments: {
    type: Number,
    default: 0
  },
  completedAssessments: {
    type: Number,
    default: 0
  },
  averageAssessmentScore: {
    type: Number,
    default: 0
  },
  bestAssessmentScore: {
    type: Number,
    default: 0
  },
  totalAssessmentTime: {
    type: Number,
    default: 0 // in minutes
  },

  // Question-specific stats
  questionStats: [questionStatSchema],

  // Learning progress
  modulesCompleted: {
    type: Number,
    default: 0
  },
  totalModulesAssigned: {
    type: Number,
    default: 0
  },
  moduleProgress: {
    type: Number,
    default: 0 // percentage
  },

  // Time tracking
  totalTimeSpent: {
    type: Number,
    default: 0 // in minutes
  },
  averageSessionTime: {
    type: Number,
    default: 0 // in minutes
  },
  lastActiveAt: {
    type: Date,
    default: Date.now
  },

  // Performance period
  period: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'overall'],
    default: 'overall'
  },
  startDate: {
    type: Date,
    required: function() {
      return this.period !== 'overall';
    }
  },
  endDate: {
    type: Date,
    required: function() {
      return this.period !== 'overall';
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
performanceMetricSchema.index({ student: 1 });
performanceMetricSchema.index({ department: 1 });
performanceMetricSchema.index({ group: 1 });
performanceMetricSchema.index({ module: 1 });
performanceMetricSchema.index({ period: 1 });
performanceMetricSchema.index({ startDate: 1, endDate: 1 });
performanceMetricSchema.index({ lastActiveAt: -1 });

// Virtuals
performanceMetricSchema.virtual('practiceSuccessRatePercentage').get(function() {
  if (this.totalPracticeSubmissions === 0) return 0;
  return ((this.acceptedSubmissions / this.totalPracticeSubmissions) * 100).toFixed(2);
});

performanceMetricSchema.virtual('assessmentCompletionRate').get(function() {
  if (this.totalAssessments === 0) return 0;
  return ((this.completedAssessments / this.totalAssessments) * 100).toFixed(2);
});

performanceMetricSchema.virtual('averageScorePercentage').get(function() {
  return this.averageAssessmentScore.toFixed(2);
});

// Instance methods
performanceMetricSchema.methods.updatePracticeStats = function(isAccepted) {
  this.totalPracticeSubmissions += 1;
  if (isAccepted) {
    this.acceptedSubmissions += 1;
  } else {
    this.rejectedSubmissions += 1;
  }
  this.practiceSuccessRate = this.totalPracticeSubmissions > 0 ?
    (this.acceptedSubmissions / this.totalPracticeSubmissions) * 100 : 0;
  this.lastActiveAt = new Date();
  return this.save();
};

performanceMetricSchema.methods.updateAssessmentStats = function(score, timeSpent, isCompleted = true) {
  this.totalAssessments += 1;
  if (isCompleted) {
    this.completedAssessments += 1;
    this.totalAssessmentTime += timeSpent;

    // Update average score
    const totalScore = this.averageAssessmentScore * (this.completedAssessments - 1) + score;
    this.averageAssessmentScore = totalScore / this.completedAssessments;

    // Update best score
    if (score > this.bestAssessmentScore) {
      this.bestAssessmentScore = score;
    }
  }
  this.lastActiveAt = new Date();
  return this.save();
};

performanceMetricSchema.methods.updateQuestionStat = function(questionId, score, timeSpent, isFirstAttempt = false) {
  let questionStat = this.questionStats.find(stat =>
    stat.question.toString() === questionId.toString()
  );

  if (!questionStat) {
    questionStat = {
      question: questionId,
      attempts: 0,
      bestScore: 0,
      firstAttemptCorrect: false,
      lastAttemptedAt: null,
      averageTime: 0
    };
    this.questionStats.push(questionStat);
  }

  questionStat.attempts += 1;
  questionStat.lastAttemptedAt = new Date();

  // Update average time
  const totalTime = questionStat.averageTime * (questionStat.attempts - 1) + timeSpent;
  questionStat.averageTime = totalTime / questionStat.attempts;

  // Update best score
  if (score > questionStat.bestScore) {
    questionStat.bestScore = score;
  }

  // Set first attempt correct if this is the first attempt and it was correct
  if (isFirstAttempt && score === 100) {
    questionStat.firstAttemptCorrect = true;
  }

  return this.save();
};

performanceMetricSchema.methods.updateModuleProgress = function(modulesAssigned, modulesCompleted) {
  this.totalModulesAssigned = modulesAssigned;
  this.modulesCompleted = modulesCompleted;
  this.moduleProgress = modulesAssigned > 0 ? (modulesCompleted / modulesAssigned) * 100 : 0;
  return this.save();
};

// Static methods
performanceMetricSchema.statics.findByStudent = function(studentId, options = {}) {
  const { period = 'overall', module = null } = options;

  const query = { student: studentId, period };
  if (module) query.module = module;

  return this.find(query)
    .populate('department', 'name code')
    .populate('group', 'name code')
    .populate('module', 'title')
    .sort({ startDate: -1 });
};

performanceMetricSchema.statics.findByGroup = function(groupId, options = {}) {
  const { period = 'overall', page = 1, limit = 10 } = options;

  return this.find({ group: groupId, period })
    .populate('student', 'fullName email')
    .populate('module', 'title')
    .sort({ averageAssessmentScore: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
};

performanceMetricSchema.statics.findByDepartment = function(departmentId, options = {}) {
  const { period = 'overall', page = 1, limit = 10 } = options;

  return this.find({ department: departmentId, period })
    .populate('student', 'fullName email')
    .populate('group', 'name code')
    .sort({ averageAssessmentScore: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
};

performanceMetricSchema.statics.getLeaderboard = function(options = {}) {
  const { group = null, department = null, period = 'overall', limit = 50 } = options;

  const query = { period };
  if (group) query.group = group;
  if (department) query.department = department;

  return this.find(query)
    .populate('student', 'fullName email profilePhoto')
    .populate('group', 'name code')
    .sort({ averageAssessmentScore: -1, bestAssessmentScore: -1 })
    .limit(limit);
};

performanceMetricSchema.statics.getStudentRank = function(studentId, options = {}) {
  const { group = null, department = null, period = 'overall' } = options;

  const query = { period };
  if (group) query.group = group;
  if (department) query.department = department;

  return this.find(query)
    .sort({ averageAssessmentScore: -1, bestAssessmentScore: -1 })
    .then(metrics => {
      const rank = metrics.findIndex(metric =>
        metric.student.toString() === studentId.toString()
      ) + 1;
      return { rank, total: metrics.length };
    });
};

// Static method to create or update performance metric
performanceMetricSchema.statics.updateOrCreate = function(filter, updateData) {
  return this.findOneAndUpdate(
    filter,
    updateData,
    { upsert: true, new: true }
  );
};

// Pre-save middleware to validate relationships
performanceMetricSchema.pre('save', async function(next) {
  if (this.isNew) {
    const User = mongoose.model('User');
    const student = await User.findById(this.student);

    if (!student) {
      const error = new Error('Student not found');
      return next(error);
    }

    // Validate department and group belong to student
    if (this.department && student.department &&
        !this.department.equals(student.department)) {
      const error = new Error('Department must match student\'s department');
      return next(error);
    }

    // Validate group is in student's groups
    const hasGroup = student.groups.some(groupId =>
      groupId.equals(this.group)
    );
    if (!hasGroup) {
      const error = new Error('Group must be one of student\'s assigned groups');
      return next(error);
    }
  }
  next();
});

module.exports = mongoose.model('PerformanceMetric', performanceMetricSchema);