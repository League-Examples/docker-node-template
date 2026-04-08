import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Home from './pages/Home';

import About from './pages/About';
import McpSetup from './pages/McpSetup';
import NotFound from './pages/NotFound';
import Account from './pages/Account';

import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
import EnvironmentInfo from './pages/admin/EnvironmentInfo';
import DatabaseViewer from './pages/admin/DatabaseViewer';
import ConfigPanel from './pages/admin/ConfigPanel';
import LogViewer from './pages/admin/LogViewer';
import SessionViewer from './pages/admin/SessionViewer';
import PermissionsPanel from './pages/admin/PermissionsPanel';
import ScheduledJobsPanel from './pages/admin/ScheduledJobsPanel';
import ImportExport from './pages/admin/ImportExport';
import UsersPanel from './pages/admin/UsersPanel';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Login (standalone, no layout) */}
          <Route path="/login" element={<Login />} />

          {/* Admin login (standalone, no layout) */}
          <Route path="/admin" element={<AdminLogin />} />

          {/* All authenticated routes share AppLayout (sidebar + topbar) */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />

            <Route path="/about" element={<About />} />
            <Route path="/account" element={<Account />} />
            <Route path="/mcp-setup" element={<McpSetup />} />

            {/* Admin pages — auth-gated by AdminLayout */}
            <Route element={<AdminLayout />}>
              <Route path="/admin/users" element={<UsersPanel />} />
              <Route path="/admin/env" element={<EnvironmentInfo />} />
              <Route path="/admin/db" element={<DatabaseViewer />} />
              <Route path="/admin/config" element={<ConfigPanel />} />
              <Route path="/admin/logs" element={<LogViewer />} />
              <Route path="/admin/sessions" element={<SessionViewer />} />
              <Route path="/admin/permissions" element={<PermissionsPanel />} />
              <Route path="/admin/scheduler" element={<ScheduledJobsPanel />} />
              <Route path="/admin/import-export" element={<ImportExport />} />

            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
