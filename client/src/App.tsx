import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ExampleIntegrations from './pages/ExampleIntegrations';
import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
import EnvironmentInfo from './pages/admin/EnvironmentInfo';
import DatabaseViewer from './pages/admin/DatabaseViewer';
import ConfigPanel from './pages/admin/ConfigPanel';
import LogViewer from './pages/admin/LogViewer';
import SessionViewer from './pages/admin/SessionViewer';

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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
