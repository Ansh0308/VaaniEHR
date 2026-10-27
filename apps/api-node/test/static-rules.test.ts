// Source-level rules that keep the architecture honest (no database needed).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../src/audit/audit.js';
import { buildOpenApi, serialiseOpenApi } from '../src/openapi/build.js';
import { OPENAPI_FILE } from '../src/openapi/generate.js';
import { allRoutes } from '../src/routes/index.js';
import { FREQUENCY_CODES } from '../src/templates/frequency.js';
import { testConfig } from './helpers.js';

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(name) ? [full] : [];
  });
}
const files = sourceFiles(SRC);
const rel = (f: string) => relative(SRC, f).replaceAll('\\', '/');
/** Source text without comment lines, so a comment that mentions a table name does not count as using it. */
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
const filesContaining = (pattern: RegExp) => files.filter((f) => pattern.test(code(f))).map(rel);

describe('ClinicOS boundary (ADR-D20)', () => {
  it('only the adapter implementation and the seed script name the mock_clinicos_* tables', () => {
    expect(filesContaining(/mock_clinicos_/).sort()).toEqual([
      'clinicos/PgMockClinicOSAdapter.ts',
      'seed/seedDev.ts',
    ]);
  });

  it('no VaaniEHR migration adds a foreign key to a mock_clinicos_* table', () => {
    const dir = join(__dirname, '..', 'migrations');
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(/references\s*:?\s*['"`(]*\s*mock_clinicos/i.test(text), name).toBe(false);
      expect(/REFERENCES\s+mock_clinicos/i.test(text), name).toBe(false);
    }
  });
});

describe('web and API agree on the audit actions', () => {
  it("the web app's action list (used for the filter and labels) equals AUDIT_ACTIONS", () => {
    const web = readFileSync(
      join(__dirname, '..', '..', 'web', 'src', 'api', 'auditActions.ts'),
      'utf8',
    );
    const listed = [...web.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...AUDIT_ACTIONS]);
  });

  it('every action has a label in both web languages', () => {
    for (const lang of ['en', 'gu']) {
      const file = join(__dirname, '..', '..', 'web', 'src', 'i18n', 'locales', lang, 'audit.json');
      const labels = JSON.parse(readFileSync(file, 'utf8')).actions as Record<string, string>;
      expect(Object.keys(labels).sort(), lang).toEqual([...AUDIT_ACTIONS].sort());
    }
  });
});

describe('single audit writer', () => {
  it('only src/audit/audit.ts inserts into audit_log', () => {
    expect(filesContaining(/INSERT\s+INTO\s+audit_log/i)).toEqual(['audit/audit.ts']);
  });

  it('no source file updates or deletes audit_log or consent_event', () => {
    expect(
      filesContaining(/(UPDATE|DELETE\s+FROM|TRUNCATE)\s+(TABLE\s+)?(audit_log|consent_event)/i),
    ).toEqual([]);
  });

  it('only the consent routes insert consent events', () => {
    expect(filesContaining(/INSERT\s+INTO\s+consent_event/i)).toEqual(['consent/routes.ts']);
  });
  it('only the consent-withdrawal function sets the signed-content flag (migration 0015)', () => {
    expect(filesContaining(/vaani\.withdrawal/)).toEqual(['transcripts/routes.ts']);
  });
  it('only the erasure service sets the erasure flag and deletes the derived tables (migration 0019)', () => {
    expect(filesContaining(/vaani\.erasure/)).toEqual(['privacy/service.ts']);
    expect(
      filesContaining(
        /DELETE\s+FROM\s+(fhir_bundle|whatsapp_summary|whatsapp_message|abha_link|abha_txn|patient_clinical_profile)/i,
      ),
    ).toEqual(['privacy/service.ts']);
  });
});

describe('no personal data in logs or audit', () => {
  it('no source file logs request bodies, passwords or tokens', () => {
    expect(
      filesContaining(/logger\.\w+\([^)]*(req\.body|password|accessToken|authorization)/is),
    ).toEqual([]);
    // Printing the VALUE of a secret (interpolation or a bare argument); plain words in messages are fine.
    expect(
      filesContaining(
        /console\.\w+\([^)]*(\$\{[^}]*(password|accessToken|token)[^}]*\}|,\s*(password|accessToken))/is,
      ),
    ).toEqual([]);
  });
});

describe('OpenAPI', () => {
  const routes = allRoutes(testConfig());
  const doc = buildOpenApi(routes) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };

  it('the committed apps/api-node/openapi.json is up to date (run `npm run openapi`)', () => {
    expect(readFileSync(OPENAPI_FILE, 'utf8')).toBe(serialiseOpenApi(buildOpenApi(routes)));
  });

  it('documents every route, with security, permission and audit information', () => {
    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const op = doc.paths[path]?.[route.method];
      expect(op, `${route.method} ${route.path} missing from OpenAPI`).toBeTruthy();
      if (route.access.kind === 'public') expect(op?.['security']).toEqual([]);
      else if (route.access.kind === 'service')
        expect(op?.['security']).toEqual([{ serviceSignature: [] }]);
      else expect(op?.['security']).toEqual([{ bearerAuth: [] }]);
      if (route.access.kind === 'permission') {
        expect(op?.['x-permission']).toBe(route.access.permission);
      }
      if (route.audit.length > 0) expect(op?.['x-audit-actions']).toEqual([...route.audit]);
    }
  });

  it('every documented path has a response schema for success', () => {
    for (const methods of Object.values(doc.paths)) {
      for (const op of Object.values(methods)) {
        expect(Object.keys(op['responses'] as object).some((c) => /^2/.test(c))).toBe(true);
      }
    }
  });
});

describe('web and API agree on the template frequency codes', () => {
  it("the web app's code list equals FREQUENCY_CODES, and every code has a label in both languages", () => {
    const web = readFileSync(
      join(__dirname, '..', '..', 'web', 'src', 'api', 'templates.ts'),
      'utf8',
    );
    const block = /FREQUENCY_CODES = \[([^\]]*)\]/.exec(web)?.[1] ?? '';
    expect([...block.matchAll(/'([A-Z]+)'/g)].map((m) => m[1])).toEqual([...FREQUENCY_CODES]);
    for (const lang of ['en', 'gu']) {
      const file = join(
        __dirname,
        '..',
        '..',
        'web',
        'src',
        'i18n',
        'locales',
        lang,
        'templates.json',
      );
      const labels = JSON.parse(readFileSync(file, 'utf8')).frequency as Record<string, string>;
      expect(Object.keys(labels).sort(), lang).toEqual([...FREQUENCY_CODES].sort());
    }
  });
});
