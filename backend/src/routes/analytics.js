const express = require('express');
const { param, query } = require('express-validator');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { User, Department, Group, Module, Question, Assessment, AssessmentSubmission, PerformanceMetric } = require('../models');

const router = express.Router();

// All analytics routes require authentication
router.use(requireAuth);

// Validation middleware
const idValidation = [
  param('id').isMongoId().withMessage('Invalid ID')
];

const dateRangeValidation = [
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('period').optional().isIn(['daily', 'weekly', 'monthly']).withMessage('Invalid period')
];

// GET /api/analytics/dashboard - System overview dashboard
router.get('/dashboard', requirePermission('manage_analytics'), async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // User statistics
    const totalUsers = await User.countDocuments({ isActive: true });
    const activeUsers = await User.countDocuments({
      isActive: true,
      lastLogin: { $gte: thirtyDaysAgo }
    });

    const userByRole = await User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $lookup: { from: 'roles', localField: '_id', foreignField: '_id', as: 'roleInfo' } },
      { $unwind: '$roleInfo' },
      { $project: { role: '$roleInfo.name', count: 1 } }
    ]);

    // Department statistics
    const totalDepartments = await Department.countDocuments({ isActive: true });
    const activeDepartments = await Department.find({ isActive: true }).select('_id name');

    const departmentStats = await Promise.all(
      activeDepartments.map(async (dept) => {
        const userCount = await User.countDocuments({
          department: dept._id,
          isActive: true
        });
        const groupCount = await Group.countDocuments({
          department: dept._id,
          isActive: true
        });
        const moduleCount = await Module.countDocuments({
          department: dept._id,
          isActive: true
        });
        const assessmentCount = await Assessment.countDocuments({
          department: dept._id,
          isActive: true
        });

        return {
          department: dept,
          userCount,
          groupCount,
          moduleCount,
          assessmentCount
        };
      })
    );

    // Content statistics
    const totalModules = await Module.countDocuments({ isActive: true });
    const totalQuestions = await Question.countDocuments({ isActive: true });
    const totalAssessments = await Assessment.countDocuments({ isActive: true });

    const questionsByType = await Question.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    const questionsByDifficulty = await Question.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$difficulty', count: { $sum: 1 } } }
    ]);

    // Activity statistics (last 30 days)
    const recentSubmissions = await AssessmentSubmission.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    const recentAssessments = await Assessment.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
      isActive: true
    });

    // Performance overview
    const averageScores = await AssessmentSubmission.aggregate([
      { $match: { status: 'submitted', createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: null,
          avgMcqScore: { $avg: '$mcqScore' },
          avgCodingScore: { $avg: '$codingScore' },
          avgTotalScore: { $avg: '$totalScore' },
          totalSubmissions: { $sum: 1 }
        }
      }
    ]);

    const scoreData = averageScores[0] || { avgMcqScore: 0, avgCodingScore: 0, avgTotalScore: 0, totalSubmissions: 0 };

    // Growth trends (last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dailyRegistrations = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const dailySubmissions = await AssessmentSubmission.aggregate([
      { $match: { submittedAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          activeUsers,
          totalDepartments,
          totalModules,
          totalQuestions,
          totalAssessments,
          recentSubmissions,
          recentAssessments
        },
        userDemographics: {
          byRole: userByRole,
          byDepartment: departmentStats
        },
        contentMetrics: {
          questionsByType,
          questionsByDifficulty
        },
        performanceOverview: {
          averageScores: scoreData,
          passRate: scoreData.totalSubmissions > 0 ?
            (await AssessmentSubmission.countDocuments({
              status: 'submitted',
              createdAt: { $gte: thirtyDaysAgo },
              totalScore: { $gte: 40 } // Assuming passing score of 40%
            }) / scoreData.totalSubmissions) * 100 : 0
        },
        trends: {
          dailyRegistrations,
          dailySubmissions
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard analytics'
    });
  }
});

// GET /api/analytics/department/:id - Department-specific analytics
router.get('/department/:id', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;

    // Check access permissions
    let hasAccess = false;
    if (user.role.name === 'Admin') {
      hasAccess = true;
    } else if (user.role.name === 'HOD' && user.department?.toString() === id) {
      hasAccess = true;
    } else if (user.role.name === 'Teacher' && user.department?.toString() === id) {
      hasAccess = true;
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to department analytics'
      });
    }

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }

    // Department statistics
    const totalUsers = await User.countDocuments({
      department: id,
      isActive: true
    });

    const usersByRole = await User.aggregate([
      { $match: { department: new mongoose.Types.ObjectId(id), isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $lookup: { from: 'roles', localField: '_id', foreignField: '_id', as: 'roleInfo' } },
      { $unwind: '$roleInfo' },
      { $project: { role: '$roleInfo.name', count: 1 } }
    ]);

    const totalGroups = await Group.countDocuments({
      department: id,
      isActive: true
    });

    const totalModules = await Module.countDocuments({
      department: id,
      isActive: true
    });

    const totalQuestions = await Question.countDocuments({
      department: id,
      isActive: true
    });

    const totalAssessments = await Assessment.countDocuments({
      department: id,
      isActive: true
    });

    // Performance metrics
    const performanceMetrics = await PerformanceMetric.find({
      department: id
    });

    const averageScore = performanceMetrics.length > 0 ?
      performanceMetrics.reduce((sum, metric) => sum + (metric.averageAssessmentScore || 0), 0) / performanceMetrics.length : 0;

    const totalPracticeSubmissions = performanceMetrics.reduce((sum, metric) => sum + (metric.totalPracticeSubmissions || 0), 0);
    const completedAssessments = performanceMetrics.reduce((sum, metric) => sum + (metric.completedAssessments || 0), 0);

    // Group performance breakdown
    const groups = await Group.find({ department: id, isActive: true });
    const groupPerformance = await Promise.all(
      groups.map(async (group) => {
        const studentCount = await User.countDocuments({
          groups: group._id,
          isActive: true
        });

        const groupMetrics = await PerformanceMetric.find({
          group: group._id
        });

        const groupAverageScore = groupMetrics.length > 0 ?
          groupMetrics.reduce((sum, metric) => sum + (metric.averageAssessmentScore || 0), 0) / groupMetrics.length : 0;

        const groupSubmissions = groupMetrics.reduce((sum, metric) => sum + (metric.totalPracticeSubmissions || 0), 0);

        return {
          group,
          studentCount,
          averageScore: groupAverageScore,
          totalSubmissions: groupSubmissions
        };
      })
    );

    // Recent activity
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentAssessments = await Assessment.find({
      department: id,
      isActive: true,
      startTime: { $gte: thirtyDaysAgo }
    }).countDocuments();

    const recentSubmissions = await AssessmentSubmission.find({
      department: id,
      createdAt: { $gte: thirtyDaysAgo }
    }).countDocuments();

    res.json({
      success: true,
      data: {
        department: {
          _id: department._id,
          name: department.name,
          code: department.code
        },
        overview: {
          totalUsers,
          totalGroups,
          totalModules,
          totalQuestions,
          totalAssessments
        },
        userDemographics: {
          byRole: usersByRole
        },
        performance: {
          averageAssessmentScore: averageScore,
          totalPracticeSubmissions,
          completedAssessments
        },
        groupPerformance: groupPerformance.sort((a, b) => b.averageScore - a.averageScore),
        recentActivity: {
          recentAssessments,
          recentSubmissions
        }
      }
    });
  } catch (error) {
    console.error('Get department analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch department analytics'
    });
  }
});

// GET /api/analytics/group/:id - Group-specific analytics
router.get('/group/:id', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;

    // Check access permissions
    let hasAccess = false;
    if (user.role.name === 'Admin') {
      hasAccess = true;
    } else if (user.role.name === 'HOD') {
      const group = await Group.findOne({ _id: id, department: user.department });
      hasAccess = !!group;
    } else if (user.role.name === 'Teacher') {
      const group = await Group.findOne({ _id: id, teacher: user._id });
      hasAccess = !!group;
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to group analytics'
      });
    }

    const group = await Group.findById(id).populate('department', 'name code');
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      });
    }

    // Group statistics
    const studentCount = await User.countDocuments({
      groups: id,
      role: 'Student',
      isActive: true
    });

    const moduleCount = await Module.countDocuments({
      groups: id,
      isActive: true
    });

    const assessmentCount = await Assessment.countDocuments({
      groups: id,
      isActive: true
    });

    // Student performance breakdown
    const students = await User.find({
      groups: id,
      role: 'Student',
      isActive: true
    });

    const studentPerformance = await Promise.all(
      students.map(async (student) => {
        const metrics = await PerformanceMetric.find({
          student: student._id,
          group: id
        });

        const practiceSubmissions = metrics.reduce((sum, metric) => sum + (metric.totalPracticeSubmissions || 0), 0);
        const completedAssessments = metrics.reduce((sum, metric) => sum + (metric.completedAssessments || 0), 0);
        const averageScore = metrics.length > 0 ?
          metrics.reduce((sum, metric) => sum + (metric.averageAssessmentScore || 0), 0) / metrics.length : 0;

        return {
          student: {
            _id: student._id,
            fullName: student.fullName,
            email: student.email
          },
          practiceSubmissions,
          completedAssessments,
          averageScore,
          lastActivity: metrics.length > 0 ?
            Math.max(...metrics.map(m => m.updatedAt)) : null
        };
      })
    );

    // Module progress
    const modules = await Module.find({ groups: id, isActive: true });
    const moduleProgress = await Promise.all(
      modules.map(async (module) => {
        const questionCount = await Question.countDocuments({
          _id: { $in: module.questions },
          isActive: true
        });

        const studentProgress = await Promise.all(
          students.map(async (student) => {
            const metrics = await PerformanceMetric.findOne({
              student: student._id,
              module: module._id
            });

            return {
              studentId: student._id,
              completedQuestions: metrics?.acceptedSubmissions || 0,
              lastAttempted: metrics?.lastAttemptedAt || null
            };
          })
        );

        const averageProgress = studentProgress.length > 0 ?
          studentProgress.reduce((sum, sp) => sum + sp.completedQuestions, 0) / (studentProgress.length * questionCount) * 100 : 0;

        return {
          module: {
            _id: module._id,
            title: module.title,
            difficulty: module.difficulty
          },
          questionCount,
          averageProgress,
          studentsStarted: studentProgress.filter(sp => sp.completedQuestions > 0).length
        };
      })
    );

    // Recent assessment performance
    const recentSubmissions = await AssessmentSubmission.find({
      assessment: { $in: await Assessment.find({ groups: id }).distinct('_id') },
      student: { $in: students.map(s => s._id) },
      status: 'submitted'
    })
    .populate('assessment', 'title')
    .populate('student', 'fullName')
    .sort({ submittedAt: -1 })
    .limit(10);

    res.json({
      success: true,
      data: {
        group: {
          _id: group._id,
          name: group.name,
          code: group.code,
          department: group.department
        },
        overview: {
          studentCount,
          moduleCount,
          assessmentCount
        },
        studentPerformance: studentPerformance.sort((a, b) => b.averageScore - a.averageScore),
        moduleProgress: moduleProgress.sort((a, b) => b.averageProgress - a.averageProgress),
        recentSubmissions
      }
    });
  } catch (error) {
    console.error('Get group analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch group analytics'
    });
  }
});

// GET /api/analytics/student/:id - Student performance analytics
router.get('/student/:id', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const currentUser = await User.findById(req.user.id).populate('role');
    const { id } = req.params;

    // Check access permissions
    let hasAccess = false;
    if (currentUser.role.name === 'Admin') {
      hasAccess = true;
    } else if (currentUser.role.name === 'HOD') {
      const student = await User.findById(id);
      hasAccess = student?.department?.toString() === currentUser.department?.toString();
    } else if (currentUser.role.name === 'Teacher') {
      const student = await User.findById(id).populate('groups');
      const teacherGroups = await Group.find({ teacher: currentUser._id });
      hasAccess = student?.groups?.some(studentGroup =>
        teacherGroups.some(teacherGroup => teacherGroup._id.equals(studentGroup._id))
      );
    } else if (currentUser.role.name === 'Student' && currentUser._id.toString() === id) {
      hasAccess = true;
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to student analytics'
      });
    }

    const student = await User.findById(id)
      .populate('department', 'name code')
      .populate('groups', 'name code');

    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'Student not found'
      });
    }

    // Overall performance metrics
    const performanceMetrics = await PerformanceMetric.find({
      student: id
    }).populate('module', 'title')
     .populate('assessment', 'title');

    const totalPracticeSubmissions = performanceMetrics.reduce((sum, metric) => sum + (metric.totalPracticeSubmissions || 0), 0);
    const acceptedSubmissions = performanceMetrics.reduce((sum, metric) => sum + (metric.acceptedSubmissions || 0), 0);
    const completedAssessments = performanceMetrics.reduce((sum, metric) => sum + (metric.completedAssessments || 0), 0);
    const averageAssessmentScore = performanceMetrics.length > 0 ?
      performanceMetrics.reduce((sum, metric) => sum + (metric.averageAssessmentScore || 0), 0) / performanceMetrics.length : 0;

    // Module-wise performance
    const modulePerformance = await Promise.all(
      [...new Set(performanceMetrics.map(m => m.module?._id).filter(Boolean))].map(async (moduleId) => {
        const moduleMetrics = performanceMetrics.filter(m => m.module?._id?.toString() === moduleId.toString());
        const module = moduleMetrics[0]?.module;

        const practiceSubmissions = moduleMetrics.reduce((sum, m) => sum + (m.totalPracticeSubmissions || 0), 0);
        const acceptedSubs = moduleMetrics.reduce((sum, m) => sum + (m.acceptedSubmissions || 0), 0);
        const avgScore = moduleMetrics.reduce((sum, m) => sum + (m.averageAssessmentScore || 0), 0) / moduleMetrics.length;

        return {
          module,
          practiceSubmissions,
          acceptedSubmissions,
          successRate: practiceSubmissions > 0 ? (acceptedSubs / practiceSubmissions) * 100 : 0,
          averageAssessmentScore: avgScore
        };
      })
    );

    // Assessment history
    const assessmentSubmissions = await AssessmentSubmission.find({
      student: id,
      status: 'submitted'
    })
    .populate('assessment', 'title startTime totalPoints')
    .sort({ submittedAt: -1 })
    .limit(20);

    // Recent activity
    const recentActivity = performanceMetrics
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
      .map(metric => ({
        type: metric.module ? 'module' : 'assessment',
        title: metric.module?.title || metric.assessment?.title,
        date: metric.updatedAt,
        score: metric.averageAssessmentScore
      }));

    // Learning streak and consistency
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyActivity = await PerformanceMetric.aggregate([
      { $match: { student: new mongoose.Types.ObjectId(id), updatedAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
          activityCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const activeDays = dailyActivity.length;
    const currentStreak = calculateCurrentStreak(dailyActivity);

    res.json({
      success: true,
      data: {
        student: {
          _id: student._id,
          fullName: student.fullName,
          email: student.email,
          department: student.department,
          groups: student.groups
        },
        overview: {
          totalPracticeSubmissions,
          acceptedSubmissions,
          completedAssessments,
          averageAssessmentScore,
          successRate: totalPracticeSubmissions > 0 ? (acceptedSubmissions / totalPracticeSubmissions) * 100 : 0
        },
        modulePerformance: modulePerformance.sort((a, b) => b.averageAssessmentScore - a.averageAssessmentScore),
        assessmentHistory: assessmentSubmissions.map(submission => ({
          assessment: submission.assessment,
          submittedAt: submission.submittedAt,
          timeTaken: submission.timeTaken,
          scores: {
            mcq: submission.mcqScore,
            coding: submission.codingScore,
            total: submission.totalScore,
            percentage: (submission.totalScore / submission.assessment.totalPoints) * 100
          },
          passed: (submission.totalScore / submission.assessment.totalPoints) >= 40
        })),
        engagement: {
          activeDays,
          currentStreak,
          dailyActivity
        },
        recentActivity
      }
    });
  } catch (error) {
    console.error('Get student analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch student analytics'
    });
  }
});

// GET /api/analytics/assessment/:id - Assessment performance analytics
router.get('/assessment/:id', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id).populate('role');
    const { id } = req.params;

    // Check access permissions
    let hasAccess = false;
    if (user.role.name === 'Admin') {
      hasAccess = true;
    } else if (user.role.name === 'HOD') {
      const assessment = await Assessment.findById(id);
      hasAccess = assessment?.department?.toString() === user.department?.toString();
    } else if (user.role.name === 'Teacher') {
      const assessment = await Assessment.findById(id);
      hasAccess = assessment?.createdBy?.toString() === user._id.toString() ||
        assessment?.groups?.some(group => user.groups.includes(group._id));
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to assessment analytics'
      });
    }

    const assessment = await Assessment.findById(id)
      .populate('department', 'name code')
      .populate('groups', 'name code')
      .populate('createdBy', 'fullName');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found'
      });
    }

    // Submission statistics
    const totalSubmissions = await AssessmentSubmission.countDocuments({
      assessment: id,
      status: 'submitted'
    });

    const submissions = await AssessmentSubmission.find({
      assessment: id,
      status: 'submitted'
    })
    .populate('student', 'fullName email')
    .sort({ totalScore: -1 });

    // Score distribution
    const scoreRanges = [
      { label: '0-20', min: 0, max: 20 },
      { label: '21-40', min: 21, max: 40 },
      { label: '41-60', min: 41, max: 60 },
      { label: '61-80', min: 61, max: 80 },
      { label: '81-100', min: 81, max: 100 }
    ];

    const scoreDistribution = scoreRanges.map(range => ({
      range: range.label,
      count: submissions.filter(s => {
        const percentage = (s.totalScore / assessment.totalPoints) * 100;
        return percentage >= range.min && percentage <= range.max;
      }).length
    }));

    // Performance statistics
    const scores = submissions.map(s => (s.totalScore / assessment.totalPoints) * 100);
    const averageScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const medianScore = scores.length > 0 ? calculateMedian(scores) : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    const passedCount = submissions.filter(s => s.totalScore >= assessment.passingScore).length;
    const passRate = submissions.length > 0 ? (passedCount / submissions.length) * 100 : 0;

    // Question-wise analysis
    const mcqQuestions = assessment.mcqQuestions;
    const codingQuestions = assessment.codingQuestions;

    const questionAnalysis = await Promise.all([
      ...mcqQuestions.map(async (mq, index) => {
        const correctAnswers = submissions.reduce((count, submission) => {
          const answer = submission.mcqAnswers.find(a => a.question.toString() === mq.question.toString());
          return count + (answer?.isCorrect ? 1 : 0);
        }, 0);

        const attempts = submissions.reduce((count, submission) => {
          return count + (submission.mcqAnswers.find(a => a.question.toString() === mq.question.toString()) ? 1 : 0);
        }, 0);

        return {
          type: 'MCQ',
          index,
          points: mq.points,
          attempts,
          correctAnswers,
          successRate: attempts > 0 ? (correctAnswers / attempts) * 100 : 0
        };
      }),
      ...codingQuestions.map(async (cq, index) => {
        const attempts = submissions.reduce((count, submission) => {
          return count + (submission.codingSubmissions.find(s => s.question.toString() === cq.question.toString())?.attempts.length || 0);
        }, 0);

        const completed = submissions.reduce((count, submission) => {
          return count + (submission.codingSubmissions.find(s => s.question.toString() === cq.question.toString())?.isCompleted ? 1 : 0);
        }, 0);

        const averageScore = submissions.reduce((sum, submission) => {
          const score = submission.codingSubmissions.find(s => s.question.toString() === cq.question.toString())?.bestScore || 0;
          return sum + score;
        }, 0) / (submissions.length || 1);

        return {
          type: 'Coding',
          index,
          points: cq.points,
          attempts,
          completed,
          averageScore
        };
      })
    ]);

    // Time analysis
    const timeData = submissions.map(s => s.timeTaken).filter(t => t);
    const averageTime = timeData.length > 0 ? timeData.reduce((sum, time) => sum + time, 0) / timeData.length : 0;

    // Group-wise performance
    const groupPerformance = await Promise.all(
      assessment.groups.map(async (group) => {
        const groupSubmissions = submissions.filter(s =>
          s.student.groups.some(g => g.toString() === group._id.toString())
        );

        const groupScores = groupSubmissions.map(s => (s.totalScore / assessment.totalPoints) * 100);
        const groupAverage = groupScores.length > 0 ? groupScores.reduce((sum, score) => sum + score, 0) / groupScores.length : 0;

        return {
          group,
          totalStudents: await User.countDocuments({
            groups: group._id,
            role: 'Student',
            isActive: true
          }),
          submissions: groupSubmissions.length,
          averageScore: groupAverage
        };
      })
    );

    res.json({
      success: true,
      data: {
        assessment: {
          _id: assessment._id,
          title: assessment.title,
          department: assessment.department,
          groups: assessment.groups,
          totalPoints: assessment.totalPoints,
          passingScore: assessment.passingScore,
          startTime: assessment.startTime,
          duration: assessment.duration
        },
        overview: {
          totalSubmissions,
          averageScore,
          medianScore,
          highestScore,
          lowestScore,
          passRate,
          averageTime
        },
        scoreDistribution,
        questionAnalysis,
        groupPerformance: groupPerformance.sort((a, b) => b.averageScore - a.averageScore),
        topPerformers: submissions.slice(0, 10).map((s, index) => ({
          rank: index + 1,
          student: s.student,
          score: (s.totalScore / assessment.totalPoints) * 100,
          timeTaken: s.timeTaken
        }))
      }
    });
  } catch (error) {
    console.error('Get assessment analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessment analytics'
    });
  }
});

// GET /api/analytics/export/:type - Export analytics data
router.get('/export/:type', [
  param('type').isIn(['users', 'departments', 'groups', 'assessments', 'performance']).withMessage('Invalid export type')
], requirePermission('manage_analytics'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { type } = req.params;
    const { format = 'json' } = req.query;

    let data;
    let filename;

    switch (type) {
      case 'users':
        data = await User.find({ isActive: true })
          .populate('role', 'name')
          .populate('department', 'name code')
          .select('fullName email role department groups createdAt lastLogin');
        filename = `users_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'departments':
        data = await Department.find({ isActive: true })
          .populate('hod', 'fullName email')
          .lean();
        filename = `departments_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'groups':
        data = await Group.find({ isActive: true })
          .populate('department', 'name code')
          .populate('teacher', 'fullName email')
          .populate('students', 'fullName email')
          .lean();
        filename = `groups_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'assessments':
        data = await Assessment.find({ isActive: true })
          .populate('department', 'name code')
          .populate('createdBy', 'fullName')
          .populate('groups', 'name code')
          .lean();
        filename = `assessments_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'performance':
        data = await PerformanceMetric.find({})
          .populate('student', 'fullName email')
          .populate('department', 'name code')
          .populate('group', 'name')
          .populate('module', 'title')
          .populate('assessment', 'title')
          .lean();
        filename = `performance_export_${new Date().toISOString().split('T')[0]}`;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid export type'
        });
    }

    if (format === 'csv') {
      // Convert to CSV format (simplified implementation)
      const csv = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    }

    // Default to JSON format
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      recordCount: data.length,
      data
    });
  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export analytics data'
    });
  }
});

// Helper functions
function calculateCurrentStreak(dailyActivity) {
  if (dailyActivity.length === 0) return 0;

  const today = new Date().toISOString().split('T')[0];
  const sortedDates = dailyActivity.map(d => d._id).sort();

  let streak = 0;
  let currentDate = new Date(today);

  // Check backwards from today
  while (sortedDates.includes(currentDate.toISOString().split('T')[0])) {
    streak++;
    currentDate.setDate(currentDate.getDate() - 1);
  }

  return streak;
}

function calculateMedian(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function convertToCSV(data) {
  if (!data || data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csvHeaders = headers.join(',');

  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object' && value.toString) return `"${value.toString().replace(/"/g, '""')}"`;
      if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
      return value;
    }).join(',');
  });

  return [csvHeaders, ...csvRows].join('\n');
}

module.exports = router;