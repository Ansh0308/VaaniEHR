// API error model. Envelope: { success: false, error: { code, message } } (Phase 1.1 API conventions).

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
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
  notImplemented: (message: string) => new AppError('NOT_IMPLEMENTED', message, 501),
  notReady: (message = 'Service not ready') => new AppError('NOT_READY', message, 503),
};
