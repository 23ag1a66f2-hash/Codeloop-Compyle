const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { PerformanceMetric, Question, AssessmentSubmission, User } = require('../models');

const router = express.Router();

// All code execution routes require authentication
router.use(requireAuth);

// Judge0 API Configuration
const JUDGE0_API_URL = process.env.JUDGE0_API_URL || 'https://judge0-ce.p.rapidapi.com';
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY;
const JUDGE0_API_HOST = process.env.JUDGE0_API_HOST || 'judge0-ce.p.rapidapi.com';

// Supported programming languages
const SUPPORTED_LANGUAGES = {
  python: { id: 71, name: 'Python 3' },
  java: { id: 62, name: 'Java 17' },
  c: { id: 50, name: 'C (GCC 9.2.0)' },
  cpp: { id: 54, name: 'C++ (GCC 9.2.0)' },
  javascript: { id: 63, name: 'JavaScript (Node.js 18.15.0)' }
};

// Maximum execution time and memory limits
const MAX_EXECUTION_TIME = 10; // seconds
const MAX_MEMORY_LIMIT = 128; // MB

// Queue for execution requests (in production, this would use Redis/Bull)
const executionQueue = new Map();

// Helper function to get language configuration
const getLanguageConfig = (language) => {
  const config = SUPPORTED_LANGUAGES[language.toLowerCase()];
  if (!config) {
    throw new Error(`Unsupported language: ${language}`);
  }
  return config;
};

// Helper function to prepare submission for Judge0
const prepareSubmission = (code, language, stdin = '') => {
  const langConfig = getLanguageConfig(language);

  return {
    source_code: code,
    language_id: langConfig.id,
    stdin: stdin,
    expected_output: null,
    max_time: MAX_EXECUTION_TIME,
    max_memory: MAX_MEMORY * 1024 * 1024, // Convert MB to bytes
    enable_per_process_and_thread_time_limit: true,
    enable_per_process_and_thread_memory_limit: true,
    compile_only: false
  };
};

// Helper function to prepare test case submission
const prepareTestCaseSubmission = (code, language, testCases) => {
  const langConfig = getLanguageConfig(language);

  return testCases.map(testCase => ({
    source_code: code,
    language_id: langConfig.id,
    stdin: testCase.input || '',
    expected_output: testCase.expectedOutput || '',
    max_time: testCase.timeLimit || MAX_EXECUTION_TIME,
    max_memory: testCase.memoryLimit || MAX_MEMORY * 1024 * 1024,
    enable_per_process_and_thread_time_limit: true,
    enable_per_process_and_thread_memory_limit: true,
    compile_only: false
  }));
};

// Helper function to format execution results
const formatExecutionResult = (result, executionId) => {
  return {
    executionId,
    status: result.status?.id || 'error',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    compile_output: result.compile_output || '',
    time: result.time || 0,
    memory: result.memory || 0,
    exit_code: result.exit_code || 0,
    exit_signal: result.exit_signal || null,
    description: result.status?.description || 'Execution completed'
  };
};

// Helper function to format test case results
const formatTestCaseResults = (results, executionId) => {
  return results.map((result, index) => ({
    testCaseIndex: index + 1,
    executionId: executionId,
    status: result.status?.id || 'error',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    compile_output: result.compile_output || '',
    time: result.time || 0,
    memory: result.memory || 0,
    exit_code: result.exit_code || 0,
    exit_signal: result.exit_signal || null,
    passed: result.status?.id === 'accepted',
    score: result.status?.id === 'accepted' ? 100 : 0
  }));
};

// POST /api/code/execute - Execute code
router.post('/execute', [
  body('code').trim().notEmpty().withMessage('Code is required'),
  body('language').isIn(Object.keys(SUPPORTED_LANGUAGES)).withMessage('Invalid programming language'),
  body('input').optional().trim(),
  body('customTestCases').optional().isArray().withMessage('Custom test cases must be an array'),
  body('timeLimit').optional().isFloat({ min: 0.1, max: MAX_EXECUTION_TIME }).withMessage(`Time limit must be between 0.1 and ${MAX_EXECUTION_TIME} seconds`),
  body('memoryLimit').optional().isInt({ min: 16, max: MAX_MEMORY }).withMessage(`Memory limit must be between 16 and ${MAX_MEMORY} MB`)
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

    const { code, language, input = '', customTestCases, timeLimit, memoryLimit } = req.body;

    // Generate unique execution ID
    const executionId = `exec_${uuidv4()}`;

    // Prepare submission data
    let submissions;
    if (customTestCases && customTestCases.length > 0) {
      // Use custom test cases
      submissions = customTestCases.map(testCase => ({
        source_code: code,
        language_id: getLanguageConfig(language).id,
        stdin: testCase.input || '',
        expected_output: testCase.expectedOutput || '',
        max_time: testCase.timeLimit || timeLimit || MAX_EXECUTION_TIME,
        max_memory: (testCase.memoryLimit || memoryLimit || MAX_MEMORY) * 1024 * 1024,
        enable_per_process_and_thread_time_limit: true,
        enable_per_process_and_thread_memory_limit: true,
        compile_only: false
      }));
    } else {
      // Single execution
      submissions = [prepareSubmission(code, language, input)];
    }

    // Check rate limiting (simple implementation)
    const user = await User.findById(req.user.id);
    const now = Date.now();
    const recentExecutions = executionQueue.get(req.user.id) || [];
    const validExecutions = recentExecutions.filter(time => now - time < 60000); // Last minute

    if (validExecutions.length >= 10) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please wait before submitting again.'
      });
    }

    // Update rate limiting queue
    validExecutions.push(now);
    executionQueue.set(req.user.id, validExecutions);

    try {
      // Submit to Judge0 API
      const promises = submissions.map(async (submission) => {
        try {
          const response = await axios.post(`${JUDGE0_API_URL}/submissions`, submission, {
            headers: {
              'X-RapidAPI-Key': JUDGE0_API_KEY,
              'X-RapidAPI-Host': JUDGE0_API_HOST,
              'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 seconds timeout
          });

          // Get submission token
          const token = response.data.token;

          // Poll for results (simplified - in production would use WebSockets or better queuing)
          let attempts = 0;
          const maxAttempts = 30;
          let result = null;

          while (attempts < maxAttempts && (!result || result.status?.id === 'processing' || result.status?.id === 'queued')) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            attempts++;

            try {
              const resultResponse = await axios.get(`${JUDGE0_API_URL}/submissions/${token}`, {
                headers: {
                  'X-RapidAPI-Key': JUDGE0_API_KEY,
                  'X-RapidAPI-Host': JUDGE0_API_HOST
                },
                timeout: 5000
              });
              result = resultResponse.data;
            } catch (error) {
              console.error('Error polling for results:', error);
              if (attempts === maxAttempts) {
                result = {
                  status: { id: 'error', description: 'Timeout while polling for results' }
                };
              }
            }
          }

          return {
            token,
            result: result || { status: { id: 'error', description: 'Failed to get results' } }
          };
        } catch (error) {
          console.error('Error submitting to Judge0:', error);
          return {
            token: null,
            result: { status: { id: 'error', description: 'Failed to submit to execution service' } }
          };
        }
      });

      const results = await Promise.all(promises);

      // Format and return results
      if (customTestCases && customTestCases.length > 0) {
        // Multiple test cases
        const testResults = results.map((item, index) => ({
          testCaseIndex: index + 1,
          token: item.token,
          ...formatExecutionResult(item.result, executionId)
        }));

        // Calculate overall score
        const passedTests = testResults.filter(test => testResult.status === 'accepted').length;
        const totalScore = Math.round((passedTests / testResults.length) * 100);

        res.json({
          success: true,
          data: {
            executionId,
            testResults,
            totalTests: testResults.length,
            passedTests,
            totalScore,
            language: getLanguageConfig(language).name
          }
        });
      } else {
        // Single execution
        const { token, result } = results[0];
        const formattedResult = formatExecutionResult(result, executionId);

        // Update performance metrics for practice submissions
        if (req.body.questionId && req.user.role.name === 'Student') {
          try {
            const question = await Question.findById(req.body.questionId);
            if (question) {
              await PerformanceMetric.findOneAndUpdate(
                {
                  student: req.user.id,
                  question: req.body.questionId,
                  department: req.user.department
                },
                {
                  $inc: { totalPracticeSubmissions: 1 },
                  $set: {
                    lastAttemptedAt: new Date()
                  }
                },
                { upsert: true, new: true }
              );

              // Mark as successful if execution was accepted
              if (result.status?.id === 'accepted') {
                await PerformanceMetric.findOneAndUpdate(
                  {
                    student: req.user.id,
                    question: req.body.questionId,
                    department: req.user.department
                  },
                  {
                    $inc: { acceptedSubmissions: 1 }
                  },
                  { upsert: true, new: true }
                );
              }
            }
          } catch (metricError) {
            console.error('Error updating performance metrics:', metricError);
          }
        }

        res.json({
          success: true,
          data: {
            executionId,
            token,
            ...formattedResult,
            language: getLanguageConfig(language).name
          }
        });
      }
    } catch (error) {
      console.error('Code execution error:', error);

      // Update failure metrics
      if (req.body.questionId && req.user.role.name === 'Student') {
        try {
          await PerformanceMetric.findOneAndUpdate(
            {
              student: req.user.id,
              question: req.body.questionId,
              department: req.user.department
            },
            {
              $inc: { totalPracticeSubmissions: 1 },
              $set: {
                lastAttemptedAt: new Date()
              }
            },
            { upsert: true, new: true }
          );
        } catch (metricError) {
          console.error('Error updating failure metrics:', metricError);
        }
      }

      res.status(500).json({
        success: false,
        error: 'Failed to execute code. Please try again later.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  } catch (error) {
    console.error('Unexpected error in code execution:', error);
    res.status(500).json({
      runInBackground: false,
      success: false,
      error: 'An unexpected error occurred during code execution'
    });
  }
});

// GET /api/code/execute/:jobId/status - Get execution status
router.get('/execute/:jobId/status', param('jobId').isLength({ min: 1 }).withMessage('Invalid job ID'), async (req, res) => {
  try {
    const { jobId } = req.params;

    // In a real implementation, this would check the status in the queue/database
    // For now, we'll simulate a status check
    res.json({
      success: true,
      data: {
        jobId,
        status: 'completed', // queued, processing, completed, error
        progress: 100,
        estimatedTime: '0-2 seconds'
      }
    });
  } catch (error) {
    console.error('Get execution status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get execution status'
    });
  }
});

// GET /api/code/execute/:jobId/result - Get execution result
router.get('/execute/:jobId/result', param('jobId').isLength({ min: 1 }).withMessage('Invalid job ID'), async (req, res) => {
  try {
    const { jobId } = req.params;

    // In a real implementation, this would retrieve the result from the database
    // For now, we'll return a mock result
    res.json({
      success: true,
      data: {
        jobId,
        status: 'completed',
        stdout: 'Hello, World!\n',
        stderr: '',
        time: 0.045,
        memory: 2048,
        exit_code: 0,
        language: 'Python 3'
      }
    });
  } catch (error) {
    console.error('Get execution result error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get execution result'
    });
  }
});

// GET /api/code/languages - Get supported programming languages
router.get('/languages', async (req, res) => {
  try {
    const languages = Object.entries(SUPPORTED_LANGUAGES).map(([key, config]) => ({
      key,
      name: config.name,
      id: config.id
    }));

    res.json({
      success: true,
      data: languages
    });
  } catch (error) {
    console.error('Get languages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get supported languages'
    });
  }
});

// POST /api/code/test - Run code against test cases
router.post('/test', [
  body('code').trim().notEmpty().withMessage('Code is required'),
  body('language').isIn(Object.keys(SUPPORTED_LANGUAGES)).withMessage('Invalid programming language'),
  body('testCases').isArray({ min: 1 }).withMessage('At least one test case is required'),
  body('testCases.*.input').notEmpty().withMessage('Test case input is required'),
  body('testCases.*.expectedOutput').notEmpty().withMessage('Test case expected output is required'),
  body('testCases.*.timeLimit').optional().isFloat({ min: 0.1, max: MAX_EXECUTION_TIME }).withMessage(`Test case time limit must be between 0.1 and ${MAX_EXECUTION_TIME} seconds`),
  body('testCases.*.memoryLimit').optional().isInt({ min: 16, max: MAX_MEMORY }).withMessage(`Test case memory limit must be between 16 and ${MAX_MEMORY} MB`)
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

    const { code, language, testCases, timeLimit, memoryLimit } = req.body;

    // Generate unique execution ID
    const executionId = `test_${uuidv4()}`;

    // Prepare test case submissions
    const submissions = prepareTestCaseSubmission(code, language, testCases);

    try {
      // Submit all test cases to Judge0
      const promises = submissions.map(async (submission, index) => {
        try {
          const response = await axios.post(`${JUDGE0_API_URL}/submissions`, submission, {
            headers: {
              'X-RapidAPI-Key': JUDGE0_API_KEY,
              'X-RapidAPI-Host': JUDGE0_API_HOST,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          });

          const token = response.data.token;

          // Poll for results
          let attempts = 0;
          const maxAttempts = 30;
          let result = null;

          while (attempts < maxAttempts && (!result || result.status?.id === 'processing' || result.status?.id === 'queued')) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;

            try {
              const resultResponse = await axios.get(`${JUDGE0_API_URL}/submissions/${token}`, {
                headers: {
                  'X-RapidAPI-Key': JUDGE0_API_KEY,
                  'X-RapidAPI-Host': JUDGE0_API_HOST
                },
                timeout: 5000
              });
              result = resultResponse.data;
            } catch (error) {
              if (attempts === maxAttempts) {
                result = {
                  status: { id: 'error', description: 'Timeout while polling for results' }
                };
              }
            }
          }

          return {
            testCaseIndex: index + 1,
            token,
            result: result || { status: { id: 'error', description: 'Failed to get results' } }
          };
        } catch (error) {
          return {
            testCaseIndex: index + 1,
            token: null,
            result: { status: { id: 'error', description: 'Failed to submit test case' } }
          };
        }
      });

      const results = await Promise.all(promises);
      const formattedResults = formatTestCaseResults(results.map(r => r.result), executionId);

      // Calculate statistics
      const passedTests = formattedResults.filter(testResult => testResult.passed).length;
      const totalTests = formattedResults.length;
      const totalScore = Math.round((passedTests / totalTests) * 100);
      const totalTime = formattedResults.reduce((sum, result) => sum + result.time, 0);
      const averageTime = totalTime / totalTests;
      const totalMemory = Math.max(...formattedResults.map(result => result.memory));

      res.json({
        success: true,
        data: {
          executionId,
          testResults: formattedResults,
          summary: {
            totalTests,
            passedTests,
            failedTests: totalTests - passedTests,
            totalScore,
            totalTime: Math.round(totalTime * 1000) / 1000, // Convert to milliseconds
            averageTime: Math.round(averageTime * 1000) / 1000,
            maxMemory: totalMemory,
            language: getLanguageConfig(language).name
          }
        }
      });
    } catch (error) {
      console.error('Test execution error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute test cases',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  } catch (error) {
    console.error('Unexpected error in test execution:', error);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred during test execution'
    });
  }
});

// GET /api/code/health - Check code execution service health
router.get('/health', async (req, res) => {
  try {
    // Check Judge0 API availability
    let judge0Status = 'unknown';
    let responseTime = null;

    if (JUDGE0_API_KEY) {
      try {
        const startTime = Date.now();
        const response = await axios.get(`${JUDGE0_API_URL}/languages`, {
          headers: {
            'X-RapidAPI-Key': JUDGE0_API_KEY,
            'X-RapidAPI-Host': JUDGE0_API_HOST
          },
          timeout: 5000
        });
        responseTime = Date.now() - startTime;
        judge0Status = response.status === 200 ? 'healthy' : 'degraded';
      } catch (error) {
        judge0Status = 'unavailable';
        console.error('Judge0 API health check failed:', error);
      }
    } else {
      judge0Status = 'not_configured';
    }

    // Check queue status
    const queueSize = executionQueue.size;
    const activeExecutions = Array.from(executionQueue.values())
      .map(executions => executions.length)
      .reduce((sum, count) => sum + count, 0);

    res.json({
      success: true,
      data: {
        status: 'healthy',
        judge0: {
          status: judge0Status,
          responseTime: responseTime ? `${responseTime}ms` : null
        },
        queue: {
          activeUsers: queueSize,
          activeExecutions,
          maxPerMinutePerUser: 10
        },
        limits: {
          maxExecutionTime: `${MAX_EXECUTION_TIME}s`,
          maxMemory: `${MAX_MEMORY}MB`,
          supportedLanguages: Object.keys(SUPPORTED_LANGUAGES).length
        }
      }
    });
  } catch (error) {
    console.error('Code execution health check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check code execution service health'
    });
  }
});

// POST /api/code/assessment-submit - Submit code for assessment
router.post('/assessment-submit', [
  body('code').trim().notEmpty().withMessage('Code is required'),
  body('language').isIn(Object.keys(SUPPORTED_LANGUAGES)).withMessage('Invalid programming language'),
  body('assessmentId').isMongoId().withMessage('Invalid assessment ID'),
  body('questionId').isMongoId().withMessage('Invalid question ID'),
  body('attemptNumber').optional().isInt({ min: 1, max: 10 }).withMessage('Attempt number must be between 1 and 10')
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

    const { code, language, assessmentId, questionId, attemptNumber = 1 } = req.body;
    const user = await User.findById(req.user.id);

    if (!user || user.role.name !== 'Student') {
      return res.status(403).json({
        success: false,
        error: 'Only students can submit assessment solutions'
      });
    }

    // Generate unique execution ID
    const executionId = `assessment_${uuidv4()}`;

    try {
      // Get test cases for the question
      const { Question } = require('../models');
      const question = await Question.findById(questionId);

      if (!question || question.type !== 'coding') {
        return res.status(404).json({
          success: false,
          error: 'Coding question not found'
        });
      }

      const testCases = question.testCases || [];

      if (testCases.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No test cases found for this question'
        });
      }

      // Prepare test case submissions
      const submissions = prepareTestCaseSubmission(code, language, testCases);

      // Submit to Judge0
      const promises = submissions.map(async (submission, index) => {
        try {
          const response = await axios.post(`${JUDGE0_API_URL}/submissions`, submission, {
            headers: {
              'headers': {
                'X-RapidAPI-Key': JUDGE0_API_KEY,
                'X-RapidAPI-Host': JUDGE0_API_HOST,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          });

          const token = response.data.token;

          // Poll for results
          let attempts = 0;
          const maxAttempts = 30;
          let result = null;

          while (attempts < maxAttempts && (!result || result.status?.id === 'processing' || result.status?.id === 'queued')) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;

            try {
              const resultResponse = await axios.get(`${JUDGE0_API_URL}/submissions/${token}`, {
                headers: {
                  'X-RapidAPI-Key': JUDGE0_API_KEY,
                  'X-RapidAPI-Host': JUDGE0_API_HOST
                },
                timeout: 5000
              });
              result = resultResponse.data;
            } catch (error) {
              if (attempts === maxAttempts) {
                result = {
                  status: { id: 'error', description: 'Timeout while polling for results' }
                };
              }
            }
          }

          return {
            testCaseIndex: index + 1,
            input: submission.stdin,
            expectedOutput: submission.expected_output,
            result: result || { status: { id: 'error', description: 'Failed to get results' } }
          };
        } catch (error) {
          return {
            testCaseIndex: index + 1,
            input: submission.stdin,
            expectedOutput: submission.expectedOutput,
            result: { status: { id: 'error', description: 'Failed to submit test case' } }
          };
        }
      });

      const results = await Promise.all(promises);
      const formattedResults = formatTestCaseResults(results.map(r => r.result), executionId);

      // Calculate score
      const passedTests = formattedResults.filter(testResult => testResult.passed).length;
      const totalTests = formattedResults.length;
      const score = Math.round((passedTests / totalTests) * 100);

      // Find or create assessment submission
      const { AssessmentSubmission } = require('../models');
      let submission = await AssessmentSubmission.findOne({
        assessment: assessmentId,
        student: user._id,
        status: { $in: ['in_progress', 'submitted'] }
      });

      if (!submission) {
        return res.status(404).json({
          success: false,
          error: 'No active assessment session found'
        });
      }

      // Find or create coding submission for this question
      let codingSubmission = submission.codingSubmissions.find(
        cs => cs.question.toString() === questionId
      );

      if (!codingSubmission) {
        codingSubmission = {
          question: questionId,
          attempts: [],
          bestScore: 0,
          isCompleted: false
        };
        submission.codingSubmissions.push(codingSubmission);
      }

      // Add this attempt
      const newAttempt = {
        code,
        language,
        submittedAt: new Date(),
        executionId,
        testResults: formattedResults,
        totalPassed: passedTests,
        totalTestCases: totalTests,
        score
      };

      codingSubmission.attempts.push(newAttempt);

      // Update best score if this attempt is better
      if (score > codingSubmission.bestScore) {
        codingSubmission.bestScore = score;
      }

      // Mark as completed if all test cases passed or max attempts reached
      const maxAttempts = 3; // This should come from the assessment configuration
      codingSubmission.isCompleted = passedTests === totalTests ||
                                codingSubmission.attempts.length >= maxAttempts;

      await submission.save();

      res.json({
        success: true,
        data: {
          executionId,
          testResults: formattedResults,
          summary: {
            totalTests,
            passedTests,
            failedTests: totalTests - passedTests,
            score,
            attemptNumber: codingSubmission.attempts.length,
            maxAttempts,
            isCompleted: codingSubmission.isCompleted
          },
          submission: {
            id: submission._id,
            codingScore: submission.codingScore + score,
            totalScore: submission.totalScore + score
          }
        }
      });
    } catch (error) {
      console.error('Assessment submission error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to submit assessment solution',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  } catch (error) {
    console.error('Unexpected error in assessment submission:', error);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred during assessment submission'
    });
  }
});

module.exports = router;