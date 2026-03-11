import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ExampleIntegrations from './pages/ExampleIntegrations';
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
      <Routes>
        <Route path="/" element={<ExampleIntegrations />} />
        <Route path="/admin" element={<AdminLogin />} />
        <Route element={<AdminLayout />}>
          <Route path="/admin/env" element={<EnvironmentInfo />} />
          <Route path="/admin/db" element={<DatabaseViewer />} />
          <Route path="/admin/config" element={<ConfigPanel />} />
          <Route path="/admin/logs" element={<LogViewer />} />
          <Route path="/admin/sessions" element={<SessionViewer />} />
          <Route path="/admin/permissions" element={<PermissionsPanel />} />
          <Route path="/admin/scheduler" element={<ScheduledJobsPanel />} />
          <Route path="/admin/import-export" element={<ImportExport />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
