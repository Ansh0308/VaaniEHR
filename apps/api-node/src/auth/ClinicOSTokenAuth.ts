// PHASE 12 STUB (ADR-D4, ADR-D12). Intentionally not implemented.
// Phase 12 will validate the user's ClinicOS bearer token via GET /api/auth/me with a short cache and require
// status === "approved". That needs an approved ClinicOS rate-limit change first (ADR-D12) and the owner's phrase
// "Phase 12 integration approved". Until then every call fails loudly rather than silently allowing access.
import { errors } from '../http/errors.js';
import type { AuthContext, AuthProvider } from './types.js';

export class ClinicOSTokenAuth implements AuthProvider {
  authenticate(_token: string): Promise<AuthContext | null> {
    return Promise.reject(
      errors.notImplemented(
        'ClinicOSTokenAuth is not implemented until Phase 12 (requires "Phase 12 integration approved")',
      ),
    );
  }
}
