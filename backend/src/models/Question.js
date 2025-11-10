const mongoose = require('mongoose');

const testCaseSchema = new mongoose.Schema({
  input: {
    type: String,
    required: [true, 'Test case input is required']
  },
  expectedOutput: {
    type: String,
    required: [true, 'Expected output is required']
  },
  isHidden: {
    type: Boolean,
    default: false
  },
  points: {
    type: Number,
    default: 10,
    min: [1, 'Points must be at least 1'],
    max: [100, 'Points cannot exceed 100']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, 'Test case description cannot exceed 200 characters']
  }
}, { _id: false });

const questionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Question title is required'],
    trim: true,
    maxlength: [300, 'Question title cannot exceed 300 characters']
  },
  description: {
    type: String,
    required: [true, 'Question description is required'],
    trim: true
  },
  type: {
    type: String,
    required: [true, 'Question type is required'],
    enum: {
      values: ['coding', 'mcq'],
      message: 'Question type must be either coding or mcq'
    }
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  modules: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Module'
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },

  // Coding question fields
  language: {
    type: String,
    enum: ['python', 'java', 'c', 'cpp', 'javascript'],
    validate: {
      validator: function(v) {
        // Language is required only for coding questions
        return this.type !== 'coding' || v;
      },
      message: 'Language is required for coding questions'
    }
  },
  testCases: [testCaseSchema],
  starterCode: {
    type: String,
    validate: {
      validator: function(v) {
        // Starter code is optional
        return true;
      }
    }
  },
  solutionCode: {
    type: String,
    validate: {
      validator: function(v) {
        // Solution code is optional
        return true;
      }
    }
  },
  timeLimit: {
    type: Number,
    default: 1, // seconds
    min: [0.1, 'Time limit must be at least 0.1 seconds'],
    max: [10, 'Time limit cannot exceed 10 seconds']
  },
  memoryLimit: {
    type: Number,
    default: 128, // MB
    min: [16, 'Memory limit must be at least 16 MB'],
    max: [1024, 'Memory limit cannot exceed 1024 MB']
  },

  // MCQ fields
  options: {
    type: [String],
    validate: {
      validator: function(v) {
        // Options are required only for MCQ questions
        return this.type !== 'mcq' || (v && v.length >= 2);
      },
      message: 'At least 2 options are required for MCQ questions'
    }
  },
  correctAnswer: {
    type: Number,
    min: 0,
    validate: {
      validator: function(v) {
        // Correct answer is required only for MCQ questions
        return this.type !== 'mcq' || (v >= 0 && this.options && v < this.options.length);
      },
      message: 'Correct answer must be a valid option index for MCQ questions'
    }
  },
  explanation: {
    type: String,
    trim: true
  },

  // Common fields
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  hints: [{
    type: String,
    trim: true
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  successfulSubmissions: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
questionSchema.index({ title: 1 });
questionSchema.index({ type: 1 });
questionSchema.index({ difficulty: 1 });
questionSchema.index({ department: 1 });
questionSchema.index({ modules: 1 });
questionSchema.index({ createdBy: 1 });
questionSchema.index({ tags: 1 });
questionSchema.index({ isActive: 1 });

// Virtual for success rate
questionSchema.virtual('successRate').get(function() {
  if (this.attempts === 0) return 0;
  return ((this.successfulSubmissions / this.attempts) * 100).toFixed(2);
});

// Virtual for total points
questionSchema.virtual('totalPoints').get(function() {
  if (this.type === 'coding' && this.testCases) {
    return this.testCases.reduce((sum, testCase) => sum + testCase.points, 0);
  }
  return 0;
});

// Instance method to add test case
questionSchema.methods.addTestCase = function(testCase) {
  this.testCases.push(testCase);
  return this.save();
};

// Instance method to remove test case
questionSchema.methods.removeTestCase = function(index) {
  if (index >= 0 && index < this.testCases.length) {
    this.testCases.splice(index, 1);
  }
  return this.save();
};

// Instance method to increment attempts
questionSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  return this.save();
};

// Instance method to increment successful submissions
questionSchema.methods.incrementSuccessfulSubmissions = function() {
  this.successfulSubmissions += 1;
  return this.save();
};

// Static method to find questions by type
questionSchema.statics.findByType = function(type, options = {}) {
  const { page = 1, limit = 10, difficulty = null, department = null } = options;

  const query = { type, isActive: true };
  if (difficulty) query.difficulty = difficulty;
  if (department) query.department = department;

  return this.find(query)
    .populate('createdBy', 'fullName')
    .populate('department', 'name code')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
};

// Static method to find questions by user access
questionSchema.statics.findByUserAccess = function(userId, options = {}) {
  const { type = null, page = 1, limit = 10, search = '' } = options;
  const User = mongoose.model('User');

  return this.find({
    isActive: true,
    $or: [
      { createdBy: userId },
      { department: await User.findById(userId).select('department') }
    ],
    ...(type && { type }),
    ...(search && {
      $or: [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ]
    })
  })
    .populate('createdBy', 'fullName')
    .populate('department', 'name code')
    .populate('modules', 'title')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
};

// Static method to get question with full details
questionSchema.statics.getWithDetails = function(questionId) {
  return this.findById(questionId)
    .populate('department', 'name code')
    .populate('createdBy', 'fullName email')
    .populate('modules', 'title');
};

// Pre-save middleware to validate question type
questionSchema.pre('save', function(next) {
  if (this.type === 'coding') {
    // Validate coding question specific fields
    if (!this.language) {
      return next(new Error('Language is required for coding questions'));
    }
    if (!this.testCases || this.testCases.length === 0) {
      return next(new Error('At least one test case is required for coding questions'));
    }
  } else if (this.type === 'mcq') {
    // Validate MCQ question specific fields
    if (!this.options || this.options.length < 2) {
      return next(new Error('At least 2 options are required for MCQ questions'));
    }
    if (typeof this.correctAnswer !== 'number' || this.correctAnswer < 0 || this.correctAnswer >= this.options.length) {
      return next(new Error('Correct answer must be a valid option index for MCQ questions'));
    }
  }
  next();
});

module.exports = mongoose.model('Question', questionSchema);