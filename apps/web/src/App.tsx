import { Navigate, Route, Routes } from 'react-router-dom';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { DesignPage } from './pages/DesignPage';
import { AppShell } from './shell/AppShell';

/** Phase 1.2: the shell, the /design page and placeholders for the PRD pages built later. */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/design" replace />} />
        <Route path="design" element={<DesignPage />} />
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
    </Routes>
  );
}
