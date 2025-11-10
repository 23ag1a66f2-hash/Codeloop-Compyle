import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Box } from '@mui/material';
import { Toaster } from 'react-hot-toast';

// Context
import { AuthProvider } from './context/AuthContext';

// Components
import PrivateRoute from './components/common/PrivateRoute';
import Layout from './components/common/Layout';

// Pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

// Dashboard Components (placeholder)
const AdminDashboard = () => <div>Admin Dashboard</div>;
const HodDashboard = () => <div>HOD Dashboard</div>;
const TeacherDashboard = () => <div>Teacher Dashboard</div>;
const StudentDashboard = () => <div>Student Dashboard</div>;

// Create theme
const theme = createTheme({
  palette: {
    primary: {
      main: '#6366f1',
      light: '#818cf8',
      dark: '#4f46e5',
    },
    secondary: {
      main: '#8b5cf6',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: {
    borderRadius: 8,
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Router>
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />

              {/* Protected Routes */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

              {/* Admin Routes */}
              <Route
                path="/admin/*"
                element={
                  <PrivateRoute requiredRole="admin">
                    <Layout>
                      <Routes>
                        <Route path="dashboard" element={<AdminDashboard />} />
                      </Routes>
                    </Layout>
                  </PrivateRoute>
                }
              />

              {/* HOD Routes */}
              <Route
                path="/hod/*"
                element={
                  <PrivateRoute requiredRole="hod">
                    <Layout>
                      <Routes>
                        <Route path="dashboard" element={<HodDashboard />} />
                      </Routes>
                    </Layout>
                  </PrivateRoute>
                }
              />

              {/* Teacher Routes */}
              <Route
                path="/teacher/*"
                element={
                  <PrivateRoute requiredRole="teacher">
                    <Layout>
                      <Routes>
                        <Route path="dashboard" element={<TeacherDashboard />} />
                      </Routes>
                    </Layout>
                  </PrivateRoute>
                }
              />

              {/* Student Routes */}
              <Route
                path="/student/*"
                element={
                  <PrivateRoute requiredRole="student">
                    <Layout>
                      <Routes>
                        <Route path="dashboard" element={<StudentDashboard />} />
                      </Routes>
                    </Layout>
                  </PrivateRoute>
                }
              />

              {/* Default Dashboard Route - redirects based on user role */}
              <Route
                path="/dashboard"
                element={
                  <PrivateRoute>
                    <Layout>
                      {/* Role-based dashboard component will be shown based on user */}
                      <div>Dashboard</div>
                    </Layout>
                  </PrivateRoute>
                }
              />

              {/* Catch-all route */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>

            {/* Toast notifications */}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#4ade80',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </Box>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
