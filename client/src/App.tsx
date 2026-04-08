import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { PendingActivationPage } from './pages/PendingActivationPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { InstructorLayout } from './components/InstructorLayout';
import { DashboardPage } from './pages/DashboardPage';
import { ReviewListPage } from './pages/ReviewListPage';
import { ReviewEditorPage } from './pages/ReviewEditorPage';
import { TemplateListPage } from './pages/TemplateListPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';
import { CheckinPage } from './pages/CheckinPage';

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

const queryClient = new QueryClient();

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            {/* Login (standalone, no layout) */}
            <Route path="/login" element={<LoginPage />} />

            {/* Pending activation (standalone, no layout) */}
            <Route path="/pending-activation" element={<PendingActivationPage />} />

            {/* Feedback (standalone, no layout) */}
            <Route path="/feedback/:token" element={<FeedbackPage />} />

            {/* Admin login (standalone, no layout) */}
            <Route path="/admin" element={<AdminLogin />} />

            {/* All authenticated routes share AppLayout (sidebar + topbar) */}
            <Route element={<AppLayout />}>
              {/* Instructor routes inside InstructorLayout */}
              <Route element={<InstructorLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/reviews" element={<ReviewListPage />} />
                <Route path="/reviews/:id" element={<ReviewEditorPage />} />
                <Route path="/templates" element={<TemplateListPage />} />
                <Route path="/templates/new" element={<TemplateEditorPage />} />
                <Route path="/templates/:id" element={<TemplateEditorPage />} />
                <Route path="/checkin" element={<CheckinPage />} />
              </Route>

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
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
