// The complete list of /api/v1 routes. Add new routes ONLY here (through a *Routes() factory) so RBAC, audit and
// OpenAPI coverage tests see them.
import { auditRoutes } from '../audit/routes.js';
import { asrInternalRoutes } from '../asr/internalRoutes.js';
import { asrRoutes } from '../asr/routes.js';
import { authRoutes } from '../auth/routes.js';
import type { Config } from '../config/env.js';
import { consentRoutes } from '../consent/routes.js';
import type { RouteDef } from '../http/routeRegistry.js';
import { factInternalRoutes } from '../facts/internalRoutes.js';
import { conceptRoutes } from '../facts/conceptRoutes.js';
import { factRoutes } from '../facts/routes.js';
import { pathwayRoutes } from '../pathways/routes.js';
import { pathwayViewerRoutes } from '../pathways/viewerRoutes.js';
import { medicineRoutes } from '../medicines/routes.js';
import { abhaRoutes } from '../abdm/routes.js';
import { whatsappRoutes } from '../whatsapp/routes.js';
import { fhirRoutes } from '../fhir/routes.js';
import { prescriptionRoutes } from '../prescription/routes.js';
import { patientRoutes } from '../patients/routes.js';
import { sessionRoutes } from '../sessions/routes.js';
import { templateRoutes } from '../templates/routes.js';
import { transcriptRoutes } from '../transcripts/routes.js';
import { visitRoutes } from '../visits/routes.js';

export const API_PREFIX = '/api/v1';

export function allRoutes(config: Config): RouteDef[] {
  return [
    ...authRoutes(config),
    ...patientRoutes(),
    ...sessionRoutes(),
    ...consentRoutes(),
    ...asrRoutes(),
    ...asrInternalRoutes(),
    ...auditRoutes(),
    ...medicineRoutes(),
    ...templateRoutes(),
    ...transcriptRoutes(),
    ...factRoutes(),
    ...factInternalRoutes(),
    ...conceptRoutes(),
    ...pathwayRoutes(),
    ...pathwayViewerRoutes(),
    ...prescriptionRoutes(),
    ...visitRoutes(),
    ...fhirRoutes(),
    ...whatsappRoutes(),
    ...abhaRoutes(),
  ];
}
