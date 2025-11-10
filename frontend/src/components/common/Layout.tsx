import React, { useState } from 'react';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Badge,
  Tooltip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard,
  School,
  People,
  Assessment,
  QuestionAnswer,
  Book,
  Notifications,
  Settings,
  Logout,
  AccountCircle,
  ExpandMore,
  ChevronLeft,
} from '@mui/icons-material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const drawerWidth = 280;

interface LayoutProps {
  children?: React.ReactNode;
}

interface NavigationItem {
  text: string;
  icon: React.ReactNode;
  path: string;
  roles?: string[];
  badge?: number;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleProfileMenuClose();
    logout();
  };

  const handleProfile = () => {
    handleProfileMenuClose();
    navigate('/profile');
  };

  const handleSettings = () => {
    handleProfileMenuClose();
    navigate('/settings');
  };

  const getNavigationItems = (): NavigationItem[] => {
    if (!user) return [];

    const baseItems: NavigationItem[] = [
      {
        text: 'Dashboard',
        icon: <Dashboard />,
        path: `/${user.role}/dashboard`,
      },
    ];

    const roleSpecificItems: Record<string, NavigationItem[]> = {
      admin: [
        {
          text: 'Users',
          icon: <People />,
          path: '/admin/users',
        },
        {
          text: 'Departments',
          icon: <School />,
          path: '/admin/departments',
        },
        {
          text: 'Groups',
          icon: <People />,
          path: '/admin/groups',
        },
        {
          text: 'Analytics',
          icon: <Assessment />,
          path: '/admin/analytics',
        },
        {
          text: 'System Settings',
          icon: <Settings />,
          path: '/admin/settings',
        },
      ],
      hod: [
        {
          text: 'Departments',
          icon: <School />,
          path: '/hod/departments',
        },
        {
          text: 'Faculty',
          icon: <People />,
          path: '/hod/faculty',
        },
        {
          text: 'Groups',
          icon: <People />,
          path: '/hod/groups',
        },
        {
          text: 'Modules',
          icon: <Book />,
          path: '/hod/modules',
        },
        {
          text: 'Analytics',
          icon: <Assessment />,
          path: '/hod/analytics',
        },
      ],
      teacher: [
        {
          text: 'My Groups',
          icon: <People />,
          path: '/teacher/groups',
        },
        {
          text: 'Modules',
          icon: <Book />,
          path: '/teacher/modules',
        },
        {
          text: 'Questions',
          icon: <QuestionAnswer />,
          path: '/teacher/questions',
        },
        {
          text: 'Assessments',
          icon: <Assessment />,
          path: '/teacher/assessments',
        },
        {
          text: 'Students',
          icon: <People />,
          path: '/teacher/students',
        },
      ],
      student: [
        {
          text: 'Modules',
          icon: <Book />,
          path: '/student/modules',
        },
        {
          text: 'Practice',
          icon: <QuestionAnswer />,
          path: '/student/practice',
        },
        {
          text: 'Assessments',
          icon: <Assessment />,
          path: '/student/assessments',
        },
        {
          text: 'Progress',
          icon: <Dashboard />,
          path: '/student/progress',
        },
        {
          text: 'Leaderboard',
          icon: <Assessment />,
          path: '/student/leaderboard',
        },
      ],
    };

    const commonItems: NavigationItem[] = [
      {
        text: 'Notices',
        icon: <Notifications />,
        path: '/notices',
        badge: 0, // TODO: Get actual unread count
      },
    ];

    return [...baseItems, ...(roleSpecificItems[user.role] || []), ...commonItems];
  };

  const navigationItems = getNavigationItems();

  const drawer = (
    <div>
      <Toolbar
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          py: 1,
        }}
      >
        <Typography variant="h6" noWrap component="div" color="primary">
          <strong>Codeloop</strong>
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {navigationItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <ListItem key={item.text} disablePadding>
              <ListItemButton
                selected={isActive}
                onClick={() => {
                  navigate(item.path);
                  setMobileOpen(false);
                }}
                sx={{
                  mx: 1,
                  borderRadius: 1,
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                    '& .MuiListItemIcon-root': {
                      color: 'primary.contrastText',
                    },
                  },
                }}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
                {item.badge > 0 && (
                  <Badge badgeContent={item.badge} color="error" />
                )}
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          bgcolor: 'background.paper',
          color: 'text.primary',
          boxShadow: 1,
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            {navigationItems.find(item => item.path === location.pathname)?.text || 'Codeloop'}
          </Typography>

          {/* User Avatar and Menu */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="Notifications">
              <IconButton color="inherit">
                <Badge badgeContent={0} color="error">
                  <Notifications />
                </Badge>
              </IconButton>
            </Tooltip>

            <Tooltip title="Profile">
              <IconButton
                onClick={handleProfileMenuOpen}
                sx={{ p: 0.5 }}
              >
                <Avatar
                  src={user?.profilePhoto}
                  alt={user?.fullName}
                  sx={{ width: 36, height: 36 }}
                >
                  {user?.fullName?.charAt(0).toUpperCase()}
                </Avatar>
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleProfileMenuClose}
              onClick={handleProfileMenuClose}
              PaperProps={{
                elevation: 3,
                sx: {
                  overflow: 'visible',
                  filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                  mt: 1.5,
                  '& .MuiAvatar-root': {
                    width: 32,
                    height: 32,
                    ml: -0.5,
                    mr: 1,
                  },
                },
              }}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <MenuItem onClick={handleProfile}>
                <Avatar src={user?.profilePhoto} sx={{ mr: 1 }} />
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    {user?.fullName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {user?.email}
                  </Typography>
                </Box>
              </MenuItem>
              <Divider />
              <MenuItem onClick={handleProfile}>
                <AccountCircle sx={{ mr: 1 }} />
                Profile
              </MenuItem>
              <MenuItem onClick={handleSettings}>
                <Settings sx={{ mr: 1 }} />
                Settings
              </MenuItem>
              <Divider />
              <MenuItem onClick={handleLogout}>
                <Logout sx={{ mr: 1 }} />
                Logout
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          minHeight: '100vh',
          bgcolor: 'background.default',
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
};

export default Layout;