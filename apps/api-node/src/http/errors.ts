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
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
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
};
