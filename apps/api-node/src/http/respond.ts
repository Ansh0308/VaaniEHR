import type { Response } from 'express';
import type { ErrorCode } from './errors.js';

export interface SuccessBody<T> {
  success: true;
  data: T;
}
export interface ErrorBody {
  success: false;
  error: { code: ErrorCode; message: string };
}

/** Success envelope: { success: true, data }. JSON keys are camelCase by convention. */
export function ok<T>(res: Response, data: T, status = 200): void {
  const body: SuccessBody<T> = { success: true, data };
  res.status(status).json(body);
}

/** Error envelope: { success: false, error: { code, message } }. */
export function fail(res: Response, status: number, code: ErrorCode, message: string): void {
  const body: ErrorBody = { success: false, error: { code, message } };
  res.status(status).json(body);
}
