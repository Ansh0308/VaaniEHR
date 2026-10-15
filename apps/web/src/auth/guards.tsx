// Route guards. These improve the experience (a role never sees a page it cannot use); they are NOT the security
// boundary: the API enforces every permission on every request (RBAC matrix tests in apps/api-node).
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
import { ForbiddenPage } from '../pages/ErrorPages';
import { useAuth } from './AuthContext';

/** Signed-out visitors go to the login page and come back to the page they asked for afterwards. */
export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Signed in, but the role may not open this page: a clear 403 page, never a silent redirect. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <ForbiddenPage />;
  return <Outlet />;
}
