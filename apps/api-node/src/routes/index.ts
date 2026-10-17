// The complete list of /api/v1 routes. Add new routes ONLY here (through a *Routes() factory) so RBAC, audit and
// OpenAPI coverage tests see them.
import { auditRoutes } from '../audit/routes.js';
import { asrRoutes } from '../asr/routes.js';
import { authRoutes } from '../auth/routes.js';
import type { Config } from '../config/env.js';
import { consentRoutes } from '../consent/routes.js';
import type { RouteDef } from '../http/routeRegistry.js';
import { medicineRoutes } from '../medicines/routes.js';
import { patientRoutes } from '../patients/routes.js';
import { sessionRoutes } from '../sessions/routes.js';
import { templateRoutes } from '../templates/routes.js';

export const API_PREFIX = '/api/v1';

export function allRoutes(config: Config): RouteDef[] {
  return [
    ...authRoutes(config),
    ...patientRoutes(),
    ...sessionRoutes(),
    ...consentRoutes(),
    ...asrRoutes(),
    ...auditRoutes(),
    ...medicineRoutes(),
    ...templateRoutes(),
  ];
}
