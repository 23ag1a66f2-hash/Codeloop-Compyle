const mongoose = require('mongoose');

const assessmentQuestionSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question',
    required: true
  },
  points: {
    type: Number,
    required: true,
    min: [1, 'Points must be at least 1'],
    max: [100, 'Points cannot exceed 100']
  },
  maxAttempts: {
    type: Number,
    default: 3,
    min: [1, 'Max attempts must be at least 1'],
    max: [10, 'Max attempts cannot exceed 10']
  },
  order: {
    type: Number,
    default: 0
  }
}, { _id: false });

const assessmentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Assessment title is required'],
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
    ref: 'Department',
    required: [true, 'Department is required']
  },
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    required: true
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },

  // Timing
  startTime: {
    type: Date,
    required: [true, 'Start time is required']
  },
  duration: {
    type: Number,
    required: [true, 'Duration is required'],
    min: [5, 'Duration must be at least 5 minutes'],
    max: [480, 'Duration cannot exceed 480 minutes (8 hours)']
  },
  endTime: {
    type: Date,
    required: true
  },

  // Questions
  codingQuestions: [assessmentQuestionSchema],
  mcqQuestions: [assessmentQuestionSchema],

  // Settings
  shuffleQuestions: {
    type: Boolean,
    default: false
  },
  shuffleOptions: {
    type: Boolean,
    default: false
  },
  showResultsImmediately: {
    type: Boolean,
    default: true
  },
  allowLateSubmission: {
    type: Boolean,
    default: false
  },
  showCorrectAnswers: {
    type: Boolean,
    default: true
  },
  preventTabSwitch: {
    type: Boolean,
    default: false
  },

  // Grading
  passingScore: {
    type: Number,
    default: 40,
    min: [0, 'Passing score cannot be negative'],
    max: [100, 'Passing score cannot exceed 100']
  },
  negativeMarking: {
    type: Boolean,
    default: false
  },
  negativeMarkingValue: {
    type: Number,
    default: 0.25,
    min: [0, 'Negative marking value cannot be negative'],
    max: [1, 'Negative marking value cannot exceed 1']
  },

  // Instructions
  instructions: {
    type: String,
    trim: true
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'started', 'completed'],
    default: 'draft'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
assessmentSchema.index({ title: 1 });
assessmentSchema.index({ department: 1 });
assessmentSchema.index({ groups: 1 });
assessmentSchema.index({ createdBy: 1 });
assessmentSchema.index({ startTime: 1 });
assessmentSchema.index({ endTime: 1 });
assessmentSchema.index({ status: 1 });
assessmentSchema.index({ isPublished: 1 });

// Virtuals
assessmentSchema.virtual('totalQuestions').get(function() {
  return (this.codingQuestions?.length || 0) + (this.mcqQuestions?.length || 0);
});

assessmentSchema.virtual('totalPoints').get(function() {
  const codingPoints = this.codingQuestions?.reduce((sum, q) => sum + q.points, 0) || 0;
  const mcqPoints = this.mcqQuestions?.reduce((sum, q) => sum + q.points, 0) || 0;
  return codingPoints + mcqPoints;
});

assessmentSchema.virtual('codingPoints').get(function() {
  return this.codingQuestions?.reduce((sum, q) => sum + q.points, 0) || 0;
});

assessmentSchema.virtual('mcqPoints').get(function() {
  return this.mcqQuestions?.reduce((sum, q) => sum + q.points, 0) || 0;
});

assessmentSchema.virtual('submissions', {
  ref: 'AssessmentSubmission',
  localField: '_id',
  foreignField: 'assessment'
});

assessmentSchema.virtual('submissionCount', {
  ref: 'AssessmentSubmission',
  localField: '_id',
  foreignField: 'assessment',
  count: true
});

// Pre-save middleware to set endTime
assessmentSchema.pre('save', function(next) {
  if (this.isModified('duration') || this.isModified('startTime')) {
    this.endTime = new Date(this.startTime.getTime() + this.duration * 60000);
  }
  next();
});

// Instance methods
assessmentSchema.methods.isAccessible = function(userId) {
  const now = new Date();

  // Check if assessment is active and published
  if (!this.isActive || !this.isPublished) {
    return false;
  }

  // Check if current time is within assessment window
  if (now < this.startTime) {
    return false; // Assessment hasn't started
  }

  if (!this.allowLateSubmission && now > this.endTime) {
    return false; // Assessment has ended and late submissions not allowed
  }

  return true;
};

assessmentessmentSchema.methods.getStatus = function() {
  const now = new Date();

  if (!this.isPublished) return 'draft';
  if (now < this.startTime) return 'upcoming';
  if (now >= this.startTime && now <= this.endTime) return 'active';
  if (now > this.endTime) return 'completed';

  return 'draft';
};

assessmentSchema.methods.addCodingQuestion = function(questionId, points = 10, maxAttempts = 3) {
  const order = this.codingQuestions.length;
  this.codingQuestions.push({
    question: questionId,
    points,
    maxAttempts,
    order
  });
  return this.save();
};

assessmentSchema.methods.addMCQQuestion = function(questionId, points = 5, maxAttempts = 1) {
  const order = this.mcqQuestions.length;
  this.mcqQuestions.push({
    question: questionId,
    points,
    maxAttempts,
    order
  });
  return this.save();
};

assessmentSchema.methods.removeQuestion = function(type, index) {
  if (type === 'coding' && index >= 0 && index < this.codingQuestions.length) {
    this.codingQuestions.splice(index, 1);
    // Reorder remaining questions
    this.codingQuestions.forEach((q, i) => q.order = i);
  } else if (type === 'mcq' && index >= 0 && index < this.mcqQuestions.length) {
    this.mcqQuestions.splice(index, 1);
    // Reorder remaining questions
    this.mcqQuestions.forEach((q, i) => q.order = i);
  }
  return this.save();
};

// Static methods
assessmentSchema.statics.findByDepartment = function(departmentId, options = {}) {
  const { page = 1, limit = 10, status = null } = options;

  const query = { department: departmentId, isActive: true };
  if (status) query.status = status;

  return this.find(query)
    .populate('createdBy', 'fullName')
    .populate('groups', 'name code')
    .sort({ startTime: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
};

assessmentSchema.statics.findByUser = async function(userId, options = {}) {
  const { page = 1, limit = 10, status = null } = options;
  const User = mongoose.model('User');

  const user = await User.findById(userId);
      const query = {
        isActive: true,
        $or: [
          { createdBy: userId },
          { groups: { $in: user.groups } }
        ]
      };
      if (status) query.status = status;

      return this.find(query)
        .populate('createdBy', 'fullName')
        .populate('department', 'name code')
        .populate('groups', 'name code')
        .sort({ startTime: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
    });
};

assessmentSchema.statics.getWithDetails = function(assessmentId) {
  return this.findById(assessmentId)
    .populate('department', 'name code')
    .populate('createdBy', 'fullName email')
    .populate('groups', 'name code')
    .populate({
      path: 'codingQuestions.question',
      match: { isActive: true }
    })
    .populate({
      path: 'mcqQuestions.question',
      match: { isActive: true }
    });
};

assessmentSchema.statics.getActiveAssessments = function(groupId = null) {
  const now = new Date();
  const query = {
    isActive: true,
    isPublished: true,
    startTime: { $lte: now },
    endTime: { $gte: now }
  };

  if (groupId) {
    query.groups = groupId;
  }

  return this.find(query)
    .populate('department', 'name code')
    .populate('createdBy', 'fullName')
    .populate('groups', 'name code')
    .sort({ startTime: 1 });
};

module.exports = mongoose.model('Assessment', assessmentSchema);