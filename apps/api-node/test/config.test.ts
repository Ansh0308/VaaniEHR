// NFR-SEC-04 (no secrets in code / fail fast), NFR-PRIV-02 (simulated-data guard), ADR-D4 (dev auth rules).
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { baseEnv, TEST_SECRET } from './helpers.js';

function problemsOf(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).message;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('accepts a valid dev config and applies safe defaults', () => {
    const cfg = loadConfig({ ...baseEnv });
    expect(cfg.simulatedDataOnly).toBe(true);
    expect(cfg.port).toBe(4000);
    expect(cfg.devTokenTtlSeconds).toBe(3600);
    expect(cfg.corsOrigin).toBe('http://localhost:5173');
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(problemsOf({ ...baseEnv, DATABASE_URL: undefined })).toContain('DATABASE_URL');
  });

  it('fails fast when the dev secret is missing, short, or a placeholder', () => {
    expect(problemsOf({ ...baseEnv, DEV_AUTH_SECRET: undefined })).toContain('DEV_AUTH_SECRET');
    expect(problemsOf({ ...baseEnv, DEV_AUTH_SECRET: 'too-short' })).toContain('at least 32');
    expect(problemsOf({ ...baseEnv, DEV_AUTH_SECRET: 'REPLACE_ME_DEV_AUTH_SECRET' })).toContain(
      'REPLACE_ME',
    );
  });

  it('never echoes secret values in error messages', () => {
    const message = problemsOf({
      ...baseEnv,
      DEV_AUTH_SECRET: 'short-secret-value-xyz',
      DATABASE_URL: 'mysql://user:hunter2@host/db',
    });
    expect(message).not.toContain('short-secret-value-xyz');
    expect(message).not.toContain('hunter2');
  });

  it('refuses the dev auth provider in production', () => {
    expect(problemsOf({ ...baseEnv, NODE_ENV: 'production' })).toContain('production');
  });

  it('refuses SIMULATED_DATA_ONLY=false (real-data mode is not permitted)', () => {
    expect(problemsOf({ ...baseEnv, SIMULATED_DATA_ONLY: 'false' })).toContain(
      'SIMULATED_DATA_ONLY',
    );
  });

  it('caps the dev token lifetime at one hour (no long-lived dev tokens)', () => {
    expect(problemsOf({ ...baseEnv, DEV_TOKEN_TTL_SECONDS: '86400' })).toContain(
      'DEV_TOKEN_TTL_SECONDS',
    );
  });

  it('requires CLINICOS_BASE_URL when AUTH_PROVIDER=clinicos, and no dev secret then', () => {
    expect(problemsOf({ ...baseEnv, AUTH_PROVIDER: 'clinicos' })).toContain('CLINICOS_BASE_URL');
    const cfg = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: baseEnv.DATABASE_URL,
      AUTH_PROVIDER: 'clinicos',
      CLINICOS_BASE_URL: 'http://localhost:5000',
    });
    expect(cfg.authProvider).toBe('clinicos');
    expect(cfg.devAuthSecret).toBeUndefined();
  });

  it('test secret itself satisfies the length rule', () => {
    expect(TEST_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
