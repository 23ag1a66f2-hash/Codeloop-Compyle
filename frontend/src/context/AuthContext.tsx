import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { User, AuthState } from '../types';
import { apiService } from '../services/api';
import toast from 'react-hot-toast';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (userData: any) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

type AuthAction =
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS'; payload: { user: User; token: string; refreshToken: string } }
  | { type: 'AUTH_FAILURE' }
  | { type: 'LOGOUT' }
  | { type: 'UPDATE_USER'; payload: User }
  | { type: 'SET_LOADING'; payload: boolean };

const initialState: AuthState = {
  user: null,
  token: localStorage.getItem('token'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: false,
  isLoading: true,
};

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'AUTH_START':
      return {
        ...state,
        isLoading: true,
      };
    case 'AUTH_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        refreshToken: action.payload.refreshToken,
        isAuthenticated: true,
        isLoading: false,
      };
    case 'AUTH_FAILURE':
      return {
        ...state,
        user: null,
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: action.payload,
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
    default:
      return state;
  }
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuthStatus = async () => {
      const token = localStorage.getItem('token');
      const refreshToken = localStorage.getItem('refreshToken');
      const userStr = localStorage.getItem('user');

      if (token && refreshToken && userStr) {
        try {
          const user = JSON.parse(userStr);
          dispatch({
            type: 'AUTH_SUCCESS',
            payload: { user, token, refreshToken },
          });

          // Validate token with server
          await apiService.auth.getProfile();
        } catch (error) {
          // Token is invalid, clear storage
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          dispatch({ type: 'AUTH_FAILURE' });
        }
      } else {
        dispatch({ type: 'AUTH_FAILURE' });
      }
    };

    checkAuthStatus();
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    try {
      dispatch({ type: 'AUTH_START' });

      const response = await apiService.auth.login(email, password);
      const { user, token, refreshToken } = response.data;

      // Store in localStorage
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));

      dispatch({
        type: 'AUTH_SUCCESS',
        payload: { user, token, refreshToken },
      });

      toast.success(`Welcome back, ${user.fullName}!`);
    } catch (error: any) {
      dispatch({ type: 'AUTH_FAILURE' });
      throw error;
    }
  };

  const register = async (userData: any): Promise<void> => {
    try {
      dispatch({ type: 'AUTH_START' });

      const response = await apiService.auth.register(userData);
      const { user, token, refreshToken } = response.data;

      // Store in localStorage
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));

      dispatch({
        type: 'AUTH_SUCCESS',
        payload: { user, token, refreshToken },
      });

      toast.success(`Welcome to Codeloop, ${user.fullName}!`);
    } catch (error: any) {
      dispatch({ type: 'AUTH_FAILURE' });
      throw error;
    }
  };

  const logout = (): void => {
    try {
      // Call logout endpoint (but don't wait for it)
      apiService.auth.logout().catch(() => {
        // Ignore errors during logout
      });
    } catch (error) {
      // Ignore errors during logout
    }

    // Clear localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    dispatch({ type: 'LOGOUT' });
    toast.success('Logged out successfully');
  };

  const refreshProfile = async (): Promise<void> => {
    try {
      const response = await apiService.auth.getProfile();
      const updatedUser = response.data;

      localStorage.setItem('user', JSON.stringify(updatedUser));
      dispatch({
        type: 'UPDATE_USER',
        payload: updatedUser,
      });
    } catch (error) {
      console.error('Failed to refresh profile:', error);
      // If refresh fails, logout user
      logout();
    }
  };

  const value: AuthContextType = {
    ...state,
    login,
    register,
    logout,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;