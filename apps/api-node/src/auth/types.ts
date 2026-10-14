// Auth seam (ADR-D4). Phase 1.1 ships DevAuthProvider; ClinicOSTokenAuth is a Phase 12 stub.

export const ROLES = ['doctor', 'staff', 'admin', 'researcher'] as const;
export type Role = (typeof ROLES)[number];

/** Identity attached to a request or socket after authentication. */
export interface AuthContext {
  /** Subject: user id (UUID). For ClinicOS users (Phase 12) this is the ClinicOS users.id. */
  sub: string;
  role: Role;
  clinicId: string;
  /** True for tokens issued by the standalone dev provider. Must never be true in production. */
  devUser?: boolean;
}

export interface AuthProvider {
  /**
   * Resolve a bearer token to an AuthContext, or null if the token is missing, malformed, expired or invalid.
   * Implementations may throw AppError for operational problems (e.g. NOT_IMPLEMENTED).
   */
  authenticate(token: string): Promise<AuthContext | null>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Request id (set by requestId middleware). */
      id: string;
      /** Set by the authenticate middleware. */
      auth?: AuthContext;
    }
  }
}
