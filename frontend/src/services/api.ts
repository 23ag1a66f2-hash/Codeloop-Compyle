import axios, { AxiosInstance, AxiosResponse } from 'axios';
import toast from 'react-hot-toast';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor to add auth token
    this.api.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response: AxiosResponse) => {
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const refreshToken = localStorage.getItem('refreshToken');
            if (refreshToken) {
              const response = await this.api.post('/auth/refresh', {
                refreshToken,
              });

              const { token } = response.data.data;
              localStorage.setItem('token', token);

              // Retry the original request
              originalRequest.headers.Authorization = `Bearer ${token}`;
              return this.api(originalRequest);
            }
          } catch (refreshError) {
            // Refresh token failed, logout user
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            window.location.href = '/login';
            return Promise.reject(refreshError);
          }
        }

        // Handle other errors
        const errorMessage = error.response?.data?.error || error.message || 'An error occurred';
        toast.error(errorMessage);

        return Promise.reject(error);
      }
    );
  }

  // Generic API methods
  async get<T = any>(url: string, params?: any): Promise<T> {
    const response = await this.api.get(url, { params });
    return response.data;
  }

  async post<T = any>(url: string, data?: any): Promise<T> {
    const response = await this.api.post(url, data);
    return response.data;
  }

  async put<T = any>(url: string, data?: any): Promise<T> {
    const response = await this.api.put(url, data);
    return response.data;
  }

  async patch<T = any>(url: string, data?: any): Promise<T> {
    const response = await this.api.patch(url, data);
    return response.data;
  }

  async delete<T = any>(url: string): Promise<T> {
    const response = await this.api.delete(url);
    return response.data;
  }

  // File upload
  async upload<T = any>(url: string, formData: FormData, onProgress?: (progress: number) => void): Promise<T> {
    const response = await this.api.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
    return response.data;
  }

  // Authentication endpoints
  auth = {
    login: (email: string, password: string) =>
      this.post('/auth/login', { email, password }),

    register: (userData: any) =>
      this.post('/auth/register', userData),

    refresh: (refreshToken: string) =>
      this.post('/auth/refresh', { refreshToken }),

    logout: () =>
      this.post('/auth/logout'),

    forgotPassword: (email: string) =>
      this.post('/auth/forgot-password', { email }),

    resetPassword: (token: string, password: string) =>
      this.post('/auth/reset-password', { token, password }),

    verifyEmail: (token: string) =>
      this.post('/auth/verify-email', { token }),

    changePassword: (currentPassword: string, newPassword: string) =>
      this.post('/auth/change-password', { currentPassword, newPassword }),

    getProfile: () =>
      this.get('/auth/profile'),

    updateProfile: (userData: any) =>
      this.put('/auth/profile', userData),
  };

  // User management
  users = {
    getAll: (params?: any) =>
      this.get('/users', params),

    getById: (id: string) =>
      this.get(`/users/${id}`),

    create: (userData: any) =>
      this.post('/users', userData),

    update: (id: string, userData: any) =>
      this.put(`/users/${id}`, userData),

    delete: (id: string) =>
      this.delete(`/users/${id}`),

    getByRole: (role: string, params?: any) =>
      this.get(`/users/role/${role}`, params),

    updateStatus: (id: string, isActive: boolean) =>
      this.patch(`/users/${id}/status`, { isActive }),

    bulkImport: (formData: FormData) =>
      this.upload('/users/bulk-import', formData),
  };

  // Department management
  departments = {
    getAll: (params?: any) =>
      this.get('/departments', params),

    getById: (id: string) =>
      this.get(`/departments/${id}`),

    create: (departmentData: any) =>
      this.post('/departments', departmentData),

    update: (id: string, departmentData: any) =>
      this.put(`/departments/${id}`, departmentData),

    delete: (id: string) =>
      this.delete(`/departments/${id}`),

    assignHOD: (id: string, hodId: string) =>
      this.patch(`/departments/${id}/hod`, { hod: hodId }),

    getStatistics: (id: string) =>
      this.get(`/departments/${id}/statistics`),

    getGroups: (id: string) =>
      this.get(`/departments/${id}/groups`),

    getModules: (id: string) =>
      this.get(`/departments/${id}/modules`),
  };

  // Group management
  groups = {
    getAll: (params?: any) =>
      this.get('/groups', params),

    getById: (id: string) =>
      this.get(`/groups/${id}`),

    create: (groupData: any) =>
      this.post('/groups', groupData),

    update: (id: string, groupData: any) =>
      this.put(`/groups/${id}`, groupData),

    delete: (id: string) =>
      this.delete(`/groups/${id}`),

    addStudents: (id: string, studentIds: string[]) =>
      this.post(`/groups/${id}/students`, { students: studentIds }),

    removeStudents: (id: string, studentIds: string[]) =>
      this.delete(`/groups/${id}/students`, { data: { students: studentIds } }),

    assignFaculty: (id: string, facultyId: string) =>
      this.patch(`/groups/${id}/faculty`, { faculty: facultyId }),

    getPerformance: (id: string) =>
      this.get(`/groups/${id}/performance`),
  };

  // Module management
  modules = {
    getAll: (params?: any) =>
      this.get('/modules', params),

    getById: (id: string) =>
      this.get(`/modules/${id}`),

    create: (moduleData: any) =>
      this.post('/modules', moduleData),

    update: (id: string, moduleData: any) =>
      this.put(`/modules/${id}`, moduleData),

    delete: (id: string) =>
      this.delete(`/modules/${id}`),

    getQuestions: (id: string) =>
      this.get(`/modules/${id}/questions`),

    getNotes: (id: string) =>
      this.get(`/modules/${id}/notes`),

    addNote: (id: string, noteData: any) =>
      this.post(`/modules/${id}/notes`, noteData),

    getProgress: (id: string, userId: string) =>
      this.get(`/modules/${id}/progress/${userId}`),

    updateProgress: (id: string, progressData: any) =>
      this.post(`/modules/${id}/progress`, progressData),
  };

  // Question management
  questions = {
    getAll: (params?: any) =>
      this.get('/questions', params),

    getById: (id: string) =>
      this.get(`/questions/${id}`),

    create: (questionData: any) =>
      this.post('/questions', questionData),

    update: (id: string, questionData: any) =>
      this.put(`/questions/${id}`, questionData),

    delete: (id: string) =>
      this.delete(`/questions/${id}`),

    getByModule: (moduleId: string) =>
      this.get(`/questions/module/${moduleId}`),

    submitPractice: (id: string, submissionData: any) =>
      this.post(`/questions/${id}/submit`, submissionData),

    getSubmissions: (id: string, params?: any) =>
      this.get(`/questions/${id}/submissions`, params),
  };

  // Assessment management
  assessments = {
    getAll: (params?: any) =>
      this.get('/assessments', params),

    getById: (id: string) =>
      this.get(`/assessments/${id}`),

    create: (assessmentData: any) =>
      this.post('/assessments', assessmentData),

    update: (id: string, assessmentData: any) =>
      this.put(`/assessments/${id}`, assessmentData),

    delete: (id: string) =>
      this.delete(`/assessments/${id}`),

    publish: (id: string) =>
      this.patch(`/assessments/${id}/publish`),

    start: (id: string) =>
      this.post(`/assessments/${id}/start`),

    submit: (id: string, submissionData: any) =>
      this.post(`/assessments/${id}/submit`, submissionData),

    getSubmissions: (id: string, params?: any) =>
      this.get(`/assessments/${id}/submissions`, params),

    getResults: (id: string) =>
      this.get(`/assessments/${id}/results`),

    addQuestion: (id: string, questionData: any) =>
      this.post(`/assessments/${id}/questions`, questionData),

    removeQuestion: (id: string, questionIndex: number, type: string) =>
      this.delete(`/assessments/${id}/questions/${questionIndex}`, { data: { type } }),
  };

  // Code execution
  codeExecution = {
    execute: (executionData: any) =>
      this.post('/code-execute', executionData),

    runTests: (questionId: string, code: string) =>
      this.post(`/code-execute/test/${questionId}`, { source_code: code }),

    getLanguages: () =>
      this.get('/code-execute/languages'),

    healthCheck: () =>
      this.get('/code-execute/health'),
  };

  // Analytics
  analytics = {
    getDashboard: () =>
      this.get('/analytics/dashboard'),

    getSystemStats: () =>
      this.get('/analytics/system'),

    getDepartmentAnalytics: (departmentId: string) =>
      this.get(`/analytics/department/${departmentId}`),

    getGroupAnalytics: (groupId: string) =>
      this.get(`/analytics/group/${groupId}`),

    getStudentAnalytics: (studentId: string) =>
      this.get(`/analytics/student/${studentId}`),

    getAssessmentAnalytics: (assessmentId: string) =>
      this.get(`/analytics/assessment/${assessmentId}`),

    exportData: (type: string, format: string, filters?: any) =>
      this.get(`/analytics/export/${type}/${format}`, filters),
  };

  // File uploads
  uploads = {
    uploadProfilePhoto: (formData: FormData) =>
      this.upload('/uploads/profile-photo', formData),

    uploadNote: (formData: FormData) =>
      this.upload('/uploads/note', formData),

    getUploadStats: () =>
      this.get('/uploads/stats'),

    healthCheck: () =>
      this.get('/uploads/health'),
  };

  // Notices
  notices = {
    getAll: (params?: any) =>
      this.get('/notices', params),

    getById: (id: string) =>
      this.get(`/notices/${id}`),

    create: (noticeData: any) =>
      this.post('/notices', noticeData),

    update: (id: string, noticeData: any) =>
      this.put(`/notices/${id}`, noticeData),

    delete: (id: string) =>
      this.delete(`/notices/${id}`),

    markAsRead: (id: string) =>
      this.patch(`/notices/${id}/read`),

    getUnreadCount: () =>
      this.get('/notices/unread/count'),

    getByTarget: (targetType: string, targetId: string) =>
      this.get(`/notices/target/${targetType}/${targetId}`),
  };

  // Performance metrics
  performance = {
    getMetrics: (userId: string, params?: any) =>
      this.get(`/performance/user/${userId}`, params),

    updateMetrics: (metricData: any) =>
      this.post('/performance', metricData),

    getLeaderboard: (params?: any) =>
      this.get('/performance/leaderboard', params),
  };
}

export const apiService = new ApiService();
export default apiService;