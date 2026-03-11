import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import Home from './pages/Home';
import Chat from './pages/Chat';
import About from './pages/About';
import Channels from './pages/Channels';
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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Authenticated routes wrapped in AppLayout (sidebar + topbar) */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/about" element={<About />} />
          </Route>

          {/* Admin login (standalone, no layout) */}
          <Route path="/admin" element={<AdminLogin />} />

          {/* Admin pages use their own AdminLayout (auth-gated) */}
          <Route element={<AdminLayout />}>
            <Route path="/admin/env" element={<EnvironmentInfo />} />
            <Route path="/admin/db" element={<DatabaseViewer />} />
            <Route path="/admin/config" element={<ConfigPanel />} />
            <Route path="/admin/logs" element={<LogViewer />} />
            <Route path="/admin/sessions" element={<SessionViewer />} />
            <Route path="/admin/permissions" element={<PermissionsPanel />} />
            <Route path="/admin/scheduler" element={<ScheduledJobsPanel />} />
            <Route path="/admin/import-export" element={<ImportExport />} />
            <Route path="/admin/channels" element={<Channels />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
