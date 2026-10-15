// Validated configuration (NFR-SEC-04: no secrets in code; fail fast on missing/unsafe config).
// Error messages name the offending variable but never echo its value.
import { z } from 'zod';

const PLACEHOLDER = /^REPLACE_ME/i;

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string()
    .min(1, 'is required')
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must start with postgres:// or postgresql://')
    .refine(
      (v) => !PLACEHOLDER.test(v) && !/REPLACE_ME/i.test(v),
      'still contains a REPLACE_ME placeholder',
    ),
  AUTH_PROVIDER: z.enum(['dev', 'clinicos']).default('dev'),
  DEV_AUTH_SECRET: z.string().optional(),
  DEV_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(3600),
  CORS_ORIGIN: z.url().default('http://localhost:5173'),
  SIMULATED_DATA_ONLY: z.enum(['true', 'false']).default('true'),
  CLINICOS_BASE_URL: z.url().optional(),
  // Login hardening (Phase 2A). Defaults mirror ClinicOS: 10 requests per 15 min per IP, 5 failures lock an account.
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  LOGIN_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  LOCKOUT_MAX_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  authProvider: 'dev' | 'clinicos';
  devAuthSecret: string | undefined;
  devTokenTtlSeconds: number;
  corsOrigin: string;
  /** Always true in this research prototype (acted/simulated data only). */
  simulatedDataOnly: true;
  clinicosBaseUrl: string | undefined;
  trustProxy: boolean;
  loginRateLimitMax: number;
  loginRateWindowMs: number;
  lockoutMaxFailures: number;
  lockoutMs: number;
  bcryptCost: number;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = rawSchema.safeParse(env);
  const problems: string[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '(root)';
      // issue.message never contains the raw value for our schemas.
      problems.push(`${key}: ${issue.message}`);
    }
    throw new ConfigError(problems);
  }

  const v = parsed.data;

  if (v.SIMULATED_DATA_ONLY !== 'true') {
    problems.push(
      'SIMULATED_DATA_ONLY: must be "true" - real-data mode is not permitted in this research prototype',
    );
  }
  if (v.AUTH_PROVIDER === 'dev') {
    if (v.NODE_ENV === 'production') {
      problems.push('AUTH_PROVIDER: "dev" is not allowed when NODE_ENV=production');
    }
    if (!v.DEV_AUTH_SECRET) {
      problems.push('DEV_AUTH_SECRET: is required when AUTH_PROVIDER=dev');
    } else if (PLACEHOLDER.test(v.DEV_AUTH_SECRET)) {
      problems.push('DEV_AUTH_SECRET: still a REPLACE_ME placeholder (run `npm run setup:env`)');
    } else if (v.DEV_AUTH_SECRET.length < 32) {
      problems.push('DEV_AUTH_SECRET: must be at least 32 characters');
    }
  }
  if (v.BCRYPT_COST < 10 && v.NODE_ENV !== 'test') {
    problems.push('BCRYPT_COST: must be at least 10 outside tests (default 12)');
  }
  if (v.AUTH_PROVIDER === 'clinicos' && !v.CLINICOS_BASE_URL) {
    problems.push('CLINICOS_BASE_URL: is required when AUTH_PROVIDER=clinicos');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv: v.NODE_ENV,
    port: v.PORT,
    databaseUrl: v.DATABASE_URL,
    authProvider: v.AUTH_PROVIDER,
    devAuthSecret: v.DEV_AUTH_SECRET,
    devTokenTtlSeconds: v.DEV_TOKEN_TTL_SECONDS,
    corsOrigin: v.CORS_ORIGIN,
    simulatedDataOnly: true,
    clinicosBaseUrl: v.CLINICOS_BASE_URL,
    trustProxy: v.TRUST_PROXY === 'true',
    loginRateLimitMax: v.LOGIN_RATE_LIMIT_MAX,
    loginRateWindowMs: v.LOGIN_RATE_WINDOW_MINUTES * 60_000,
    lockoutMaxFailures: v.LOCKOUT_MAX_FAILURES,
    lockoutMs: v.LOCKOUT_MINUTES * 60_000,
    bcryptCost: v.BCRYPT_COST,
  };
}
