export interface User {
  _id: string;
  fullName: string;
  email: string;
  role: 'admin' | 'hod' | 'teacher' | 'student';
  profilePhoto?: string;
  department?: Department;
  groups?: Group[];
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  _id: string;
  name: string;
  code: string;
  description?: string;
  hod?: User;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  _id: string;
  name: string;
  code: string;
  department: Department;
  faculty?: User;
  students: User[];
  maxCapacity: number;
  currentStrength: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Module {
  _id: string;
  title: string;
  description: string;
  department: Department;
  prerequisites: Module[];
  content: string;
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedHours: number;
  isActive: boolean;
  createdBy: User;
  createdAt: string;
  updatedAt: string;
}

export interface Question {
  _id: string;
  title: string;
  description: string;
  type: 'coding' | 'mcq';
  difficulty: 'easy' | 'medium' | 'hard';
  department?: Department;
  modules?: Module[];
  createdBy: User;
  language?: 'python' | 'java' | 'c' | 'cpp' | 'javascript';
  testCases?: TestCase[];
  starterCode?: string;
  solutionCode?: string;
  options?: string[];
  correctAnswer?: number;
  explanation?: string;
  tags: string[];
  hints: string[];
  timeLimit?: number;
  memoryLimit?: number;
  isActive: boolean;
  attempts: number;
  successfulSubmissions: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
  points: number;
  description?: string;
}

export interface Assessment {
  _id: string;
  title: string;
  description?: string;
  department: Department;
  groups: Group[];
  createdBy: User;
  startTime: string;
  duration: number;
  endTime: string;
  codingQuestions: AssessmentQuestion[];
  mcqQuestions: AssessmentQuestion[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResultsImmediately: boolean;
  allowLateSubmission: boolean;
  showCorrectAnswers: boolean;
  preventTabSwitch: boolean;
  passingScore: number;
  negativeMarking: boolean;
  negativeMarkingValue: number;
  instructions?: string;
  isActive: boolean;
  isPublished: boolean;
  status: 'draft' | 'published' | 'started' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentQuestion {
  question: Question;
  points: number;
  maxAttempts: number;
  order: number;
}

export interface AssessmentSubmission {
  _id: string;
  assessment: Assessment;
  student: User;
  codingAnswers: SubmissionAnswer[];
  mcqAnswers: SubmissionAnswer[];
  startedAt: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  percentage: number;
  passed: boolean;
  timeTaken: number;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionAnswer {
  question: Question;
  answer: string | number;
  isCorrect?: boolean;
  score: number;
  timeTaken: number;
  testCases?: TestCaseResult[];
  submittedAt: string;
}

export interface TestCaseResult {
  input: string;
  expectedOutput: string;
  actualOutput?: string;
  passed: boolean;
  points: number;
  executionTime?: number;
  memoryUsage?: number;
  error?: string;
}

export interface PerformanceMetric {
  _id: string;
  student: User;
  department?: Department;
  group?: Group;
  module?: Module;
  question?: Question;
  assessment?: Assessment;
  metricType: 'practice' | 'assessment' | 'module_progress' | 'overall';
  totalSubmissions: number;
  successfulSubmissions: number;
  averageScore: number;
  bestScore: number;
  averageTimeTaken: number;
  totalActiveTime: number;
  streak: number;
  lastActivityDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notice {
  _id: string;
  title: string;
  content: string;
  type: 'general' | 'urgent' | 'academic' | 'event';
  targetType: 'all' | 'department' | 'group' | 'role';
  targetId?: string;
  targetRole?: 'admin' | 'hod' | 'teacher' | 'student';
  createdBy: User;
  isActive: boolean;
  expiresAt?: string;
  attachments: string[];
  readBy: User[];
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CodeExecutionRequest {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  max_time?: number;
  max_memory?: number;
}

export interface CodeExecutionResult {
  token: string;
  status: {
    id: number;
    description: string;
  };
  stdout?: string;
  stderr?: string;
  compile_output?: string;
  time?: number;
  memory?: number;
  exit_code?: number;
  exit_signal?: number;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T = any> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ModuleProgress {
  module: Module;
  completed: boolean;
  progressPercentage: number;
  timeSpent: number;
  lastAccessedAt: string;
  completedAt?: string;
}

export interface AnalyticsData {
  totalUsers: number;
  totalDepartments: number;
  totalGroups: number;
  totalModules: number;
  totalQuestions: number;
  totalAssessments: number;
  userGrowth: Array<{ month: string; count: number }>;
  departmentStats: Array<{
    department: Department;
    users: number;
    groups: number;
    avgPerformance: number;
  }>;
  recentActivities: Array<{
    type: string;
    user: User;
    description: string;
    timestamp: string;
  }>;
}

export interface AssessmentSession {
  assessment: Assessment;
  submission: AssessmentSubmission;
  currentQuestionIndex: number;
  timeRemaining: number;
  isSubmitted: boolean;
  securityViolations: number;
}

export interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical';
  services: {
    database: 'connected' | 'disconnected';
    judge0: 'connected' | 'disconnected';
    storage: 'healthy' | 'full' | 'error';
  };
  uptime: number;
  version: string;
  lastChecked: string;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  assessments: boolean;
  notices: boolean;
  results: boolean;
  reminders: boolean;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  language: string;
  timezone: string;
  notifications: NotificationSettings;
  privacy: {
    profileVisible: boolean;
    showResults: boolean;
    allowAnalytics: boolean;
  };
}

export interface ErrorDetails {
  field?: string;
  message: string;
  code?: string;
  value?: any;
}

export interface FormError {
  [key: string]: string | undefined;
}

export interface TableColumn {
  field: string;
  headerName: string;
  width: number;
  editable?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'date' | 'dateTime' | 'actions';
  valueGetter?: (params: any) => any;
  valueFormatter?: (params: any) => string;
  renderCell?: (params: any) => React.ReactNode;
}

export interface FilterOptions {
  search?: string;
  department?: string;
  group?: string;
  difficulty?: string;
  type?: string;
  status?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface SortOptions {
  field: string;
  order: 'asc' | 'desc';
}

export interface ExportOptions {
  format: 'csv' | 'json' | 'xlsx';
  fields?: string[];
  filters?: FilterOptions;
}

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalDepartments: number;
  totalGroups: number;
  totalModules: number;
  totalQuestions: number;
  totalAssessments: number;
  recentRegistrations: number;
  completionRate: number;
  avgPerformance: number;
}

export interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
  }>;
}

export interface Activity {
  id: string;
  type: 'login' | 'submission' | 'assessment' | 'module' | 'question';
  user: User;
  description: string;
  timestamp: string;
  metadata?: Record<string, any>;
}