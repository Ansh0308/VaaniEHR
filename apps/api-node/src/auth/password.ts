// Password hashing: bcryptjs (pure JavaScript), same scheme and default cost 12 as ClinicOS.
// Passwords are never logged and never put in audit metadata.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string, cost: number): Promise<string> {
  return bcrypt.hash(password, cost);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A hash of a random string, computed once at the configured cost. Login compares against it when the e-mail is
 * unknown, so "unknown user" and "wrong password" take about the same time (no user enumeration by timing).
 */
export async function makeDummyHash(cost: number): Promise<string> {
  return bcrypt.hash(randomBytes(16).toString('hex'), cost);
}
