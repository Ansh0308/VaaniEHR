// API error model. Envelope: { success: false, error: { code, message } } (Phase 1.1 API conventions).

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'CONSENT_REQUIRED'
  | 'NOT_IMPLEMENTED'
  | 'NOT_READY'
  | 'SIGN_BLOCKED'
  | 'SAFETY_ACK_REQUIRED'
  | 'SAFETY_ERROR'
  | 'INVALID_PASSWORD'
  | 'VISIT_SIGNED'
  | 'ABHA_IDENTITY_REJECTED'
  | 'ABHA_OTP_WRONG'
  | 'ABHA_OTP_EXPIRED'
  | 'ABHA_RATE_LIMITED'
  | 'ABHA_UNAVAILABLE'
  | 'ABHA_NOT_FOUND'
  | 'ABHA_FAILED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    /** machine-readable extras for the client (the named blockers of a refused sign-off); never clinical text */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  badRequest: (message = 'Bad request') => new AppError('BAD_REQUEST', message, 400),
  validation: (message: string) => new AppError('VALIDATION_ERROR', message, 400),
  unauthenticated: (message = 'Authentication required') =>
    new AppError('UNAUTHENTICATED', message, 401),
  forbidden: (message = 'You do not have permission to access this resource') =>
    new AppError('FORBIDDEN', message, 403),
  notFound: (message = 'Route not found') => new AppError('NOT_FOUND', message, 404),
  conflict: (message: string) => new AppError('CONFLICT', message, 409),
  locked: (message = 'Account temporarily locked. Try again later.') =>
    new AppError('ACCOUNT_LOCKED', message, 429),
  rateLimited: (message = 'Too many requests. Please try again later.') =>
    new AppError('RATE_LIMITED', message, 429),
  consentRequired: (message: string) => new AppError('CONSENT_REQUIRED', message, 403),
  notImplemented: (message: string) => new AppError('NOT_IMPLEMENTED', message, 501),
  notReady: (message = 'Service not ready') => new AppError('NOT_READY', message, 503),
  signBlocked: (blockers: readonly unknown[]) =>
    new AppError('SIGN_BLOCKED', 'The visit cannot be signed yet', 409, { blockers }),
  safetyAckRequired: () =>
    new AppError(
      'SAFETY_ACK_REQUIRED',
      'Safety checks were not run: acknowledge this to sign',
      400,
    ),
  safetyError: () =>
    new AppError(
      'SAFETY_ERROR',
      'The safety checks failed to run, so this visit cannot be signed now. Try again later',
      503,
    ),
  // 403, not 401: a wrong password at sign-off must not look like an expired session to the client
  invalidPassword: () => new AppError('INVALID_PASSWORD', 'The password is not correct', 403),
  visitSigned: () =>
    new AppError(
      'VISIT_SIGNED',
      'This visit is signed and cannot be changed; amend it instead',
      409,
    ),
};
