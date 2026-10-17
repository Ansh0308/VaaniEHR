import { Navigate, Route, Routes } from 'react-router-dom';
import { homeFor, useAuth } from './auth/AuthContext';
import { RequireAuth, RequireRole } from './auth/guards';
import { AuditPage } from './pages/AuditPage';
import { ConsentPage } from './pages/ConsentPage';
import { DashboardPage } from './pages/DashboardPage';
import { DesignPage } from './pages/DesignPage';
import { ForbiddenPage, NotFoundPage, ServerErrorPage } from './pages/ErrorPages';
import { LoginPage } from './pages/LoginPage';
import { MedicinesPage } from './pages/MedicinesPage';
import { PatientsPage } from './pages/PatientsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { SettingsPage } from './pages/SettingsPage';
import { TemplateBuilderPage } from './pages/TemplateBuilderPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { AppShell } from './shell/AppShell';
import { ShellOrPublic } from './shell/PublicShell';

/** "/" sends people to their own home page, or to the login page. */
function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

/**
 * Pages from the PRD page list (section 4). The route guards only decide what a role is shown; the API enforces
 * every permission itself. Pages that are built in later phases open a labelled placeholder.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/500" element={<ServerErrorPage />} />
      {/* the design-system specimen shows no data, so it can be opened without signing in */}
      <Route element={<ShellOrPublic />}>
        <Route path="/design" element={<DesignPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route element={<RequireRole roles={['doctor']} />}>
            <Route path="doctor" element={<DashboardPage />} />
          </Route>
          <Route element={<RequireRole roles={['staff', 'admin']} />}>
            <Route path="patients" element={<PatientsPage />} />
          </Route>
          <Route element={<RequireRole roles={['doctor', 'staff', 'admin']} />}>
            <Route path="consult/:sessionId/consent" element={<ConsentPage />} />
          </Route>
          <Route element={<RequireRole roles={['admin', 'researcher']} />}>
            <Route path="admin/audit" element={<AuditPage />} />
          </Route>
          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="admin/medicines" element={<MedicinesPage />} />
          </Route>
          <Route element={<RequireRole roles={['doctor', 'admin']} />}>
            <Route path="admin/templates" element={<TemplatesPage />} />
            <Route path="admin/templates/new" element={<TemplateBuilderPage key="new" />} />
            <Route path="admin/templates/:id" element={<TemplateBuilderPage key="edit" />} />
          </Route>
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
