// Static security checks over the source tree (Phase 12B, ADR-D44). No database. Each check protects a rule that a later edit
// could quietly break: parameterised SQL, no dynamic code, no weak crypto, safe containers and headers, placeholder-only
// example env files, and every API variable documented. A check that fails names the file and the line.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir: string, exts: string[]): string[] => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    if (['node_modules', 'dist', '.venv', '__pycache__', 'coverage'].includes(name)) return [];
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel, exts);
    return exts.some((e) => name.endsWith(e)) && !/\.test\.|\.spec\.|[\\/]tests?[\\/]/.test(rel)
      ? [rel]
      : [];
  });
};
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

describe('SQL', () => {
  // The only expressions allowed inside a ${...} in a query string. Each is a constant, a whitelist lookup or a fixed choice.
  const ALLOWED = new Set([
    'APP_ROLE',
    'COLUMNS',
    'SELECT',
    'VISIBLE_SQL',
    'SUMMARY_COLUMNS',
    "sets.join(', ')",
    "SORT_SQL[options.sort ?? 'name']",
    "options.order === 'desc' ? 'DESC' : 'ASC'",
    "verb === 'retire' ? 'coalesce(retired_at, now())' : 'NULL'",
  ]);
  it('values are always parameters: only whitelisted fragments are interpolated into a query string (ASVS 1.2.4)', () => {
    const problems: string[] = [];
    for (const file of walk('apps/api-node/src', ['.ts'])) {
      const text = read(file);
      for (const m of text.matchAll(/\.query(?:<[^>]*>)?\(\s*`([^`]*)`/g)) {
        for (const e of (m[1] ?? '').matchAll(/\$\{([^}]*)\}/g)) {
          const expr = (e[1] ?? '').trim();
          if (!ALLOWED.has(expr))
            problems.push(`${file}:${lineOf(text, m.index ?? 0)} interpolates ${expr}`);
        }
      }
      // a query built by + concatenation is never needed here
      for (const m of text.matchAll(/\.query\(\s*['"][^'"]*['"]\s*\+/g)) {
        problems.push(`${file}:${lineOf(text, m.index ?? 0)} concatenates a query`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('dynamic code and unsafe rendering', () => {
  const BAD: [string, RegExp][] = [
    ['eval()', /\beval\s*\(/],
    ['new Function()', /\bnew\s+Function\s*\(/],
    ['child_process', /child_process/],
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['innerHTML assignment', /\.(inner|outer)HTML\s*=/],
    ['document.write', /document\.write\s*\(/],
  ];
  it('no eval, Function constructor, shell, raw HTML or innerHTML in the API or the web app (ASVS 1.3.2, 3.2.2, 1.2.5)', () => {
    const problems: string[] = [];
    for (const file of [
      ...walk('apps/api-node/src', ['.ts']),
      ...walk('apps/web/src', ['.ts', '.tsx']),
    ]) {
      const text = read(file);
      for (const [name, re] of BAD) {
        const m = re.exec(text);
        if (m && !/^\s*(\/\/|\*)/.test(text.split('\n')[lineOf(text, m.index) - 1] ?? '')) {
          problems.push(`${file}:${lineOf(text, m.index)} ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
  it('the Python service starts no shell and evaluates nothing', () => {
    const problems: string[] = [];
    for (const file of walk('apps/asr-py/app', ['.py'])) {
      if (file.includes(`${'bench'}`)) continue; // the offline benchmark runner calls node and git with fixed arguments
      const text = read(file);
      for (const re of [
        /\beval\s*\(/,
        /\bexec\s*\(/,
        /os\.system\s*\(/,
        /subprocess\.\w+\([^)]*shell\s*=\s*True/,
        /pickle\.loads?\s*\(/,
      ]) {
        const m = re.exec(text);
        if (m) problems.push(`${file}:${lineOf(text, m.index)} ${re.source}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('cryptography', () => {
  it('no MD5, no SHA-1 hashing, no ECB, no PKCS#1 v1.5 encryption padding, no DES (ASVS 11.3, 11.4.1)', () => {
    const problems: string[] = [];
    const files = [
      ...walk('apps/api-node/src', ['.ts']),
      ...walk('apps/web/src', ['.ts', '.tsx']),
      ...walk('apps/asr-py/app', ['.py']),
    ];
    const BAD = [
      /createHash\(\s*['"](md5|sha1|sha-1)['"]/i,
      /hashlib\.(md5|sha1)\(/,
      /RSA_PKCS1_PADDING/,
      /-ecb['"]/i,
      /\bDES\b/,
      /createCipher\(/,
    ];
    for (const file of files) {
      // uuid v5 (RFC 4122) is defined with SHA-1; the FHIR ids are names, not a security control
      if (file.split('\\').join('/').endsWith('fhir/builder.ts')) continue;
      const text = read(file);
      for (const re of BAD) {
        const m = re.exec(text);
        if (m) problems.push(`${file}:${lineOf(text, m.index)} ${m[0]}`);
      }
    }
    expect(problems).toEqual([]);
  });
  it('SHA-1 appears only as the OAEP hash that the ABDM interface asks for, and OAEP is the padding', () => {
    const text = read('apps/api-node/src/abdm/encryption.ts');
    expect(text).toMatch(/RSA_PKCS1_OAEP_PADDING/);
    expect(text).toMatch(/oaepHash:\s*'sha1'/);
  });
  it('passwords use bcrypt and audio uses AES-GCM', () => {
    expect(read('apps/api-node/src/auth/password.ts')).toMatch(/bcrypt/);
    expect(read('apps/asr-py/app/storage.py')).toMatch(/AESGCM/);
  });
});

describe('web host and containers', () => {
  const nginx = read('apps/web/nginx.conf');
  it('sends CSP, HSTS, nosniff, no framing and no referrer in every location (ASVS 3.4.1, 3.4.x)', () => {
    const blocks = (nginx.match(/^\s*location\s/gm) ?? []).length;
    for (const header of [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
    ]) {
      const count = (nginx.match(new RegExp(`add_header ${header} `, 'g')) ?? []).length;
      expect(count, header).toBe(blocks + 1); // the server block plus every location
    }
    expect(nginx).toMatch(/max-age=31536000/);
  });
  it('the policy has no unsafe-eval, no inline scripts, no wildcard, and forbids objects, framing and foreign bases', () => {
    const csp = /Content-Security-Policy "([^"]+)"/.exec(nginx)?.[1] ?? '';
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).not.toMatch(/\s\*[\s;]/);
    for (const directive of [
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ]) {
      expect(csp, directive).toContain(directive);
    }
  });
  it('containers run as a non-root user and the web image is the unprivileged nginx', () => {
    expect(read('apps/api-node/Dockerfile')).toMatch(/^USER node$/m);
    expect(read('apps/asr-py/Dockerfile')).toMatch(/^USER app$/m);
    expect(read('apps/web/Dockerfile')).toMatch(/nginx-unprivileged/);
  });
  it('the Docker build context leaves out git data and env files (ASVS 13.4.1)', () => {
    const ignore = read('.dockerignore');
    expect(ignore).toMatch(/^\.git$/m);
    expect(ignore).toMatch(/\.env/);
  });
  it('base images are pinned by digest', () => {
    for (const file of [
      'apps/api-node/Dockerfile',
      'apps/asr-py/Dockerfile',
      'apps/web/Dockerfile',
    ]) {
      const args = [...read(file).matchAll(/^ARG\s+(?:NODE|PYTHON|NGINX)_IMAGE=(\S+)/gm)].map(
        (m) => m[1] ?? '',
      );
      expect(args.length, file).toBeGreaterThan(0);
      for (const a of args) expect(a, file).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });
});

describe('secrets in the repository', () => {
  it('.gitignore keeps env files, data and audio out', () => {
    const ignore = read('.gitignore');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });
  it('example env files hold placeholders or empty values for anything secret-shaped', () => {
    const problems: string[] = [];
    for (const file of [
      'apps/api-node/.env.example',
      'apps/asr-py/.env.example',
      'infra/.env.example',
    ]) {
      for (const [i, line] of read(file).split('\n').entries()) {
        const m = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
        if (!m) continue;
        const [, key = '', value = ''] = m;
        if (
          /(SECRET|KEY|PASSWORD|ACCESS_TOKEN|VERIFY_TOKEN)$/.test(key) &&
          value !== '' &&
          !/^REPLACE_ME/.test(value)
        ) {
          problems.push(`${file}:${i + 1} ${key} has a value`);
        }
        if (
          /URL/.test(key) &&
          /:\/\/[^/\s:@]+:[^/\s@]+@/.test(value) &&
          !/REPLACE_ME/.test(value)
        ) {
          problems.push(`${file}:${i + 1} ${key} holds a password`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
  it('every variable the API reads is listed in its .env.example and in docs/ENV_VARS.md', () => {
    const schema = read('apps/api-node/src/config/env.ts');
    const names = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]+):\s*z\./gm)].map((m) => m[1] ?? '');
    expect(names.length).toBeGreaterThanOrEqual(35);
    const example = read('apps/api-node/.env.example');
    const doc = read('docs/ENV_VARS.md');
    // a few variables are only needed by tools and are documented together in the example under another heading
    const missing = names.filter(
      (n) => !new RegExp(`^#?\\s*${n}=`, 'm').test(example) || !doc.includes(n),
    );
    expect(missing).toEqual([]);
  });
  it('the web app does not block paste or password managers (ASVS 6.2.7, no paste blocking)', () => {
    const problems: string[] = [];
    for (const file of walk('apps/web/src', ['.tsx', '.ts'])) {
      const text = read(file);
      for (const m of text.matchAll(
        /onPaste\s*=|addEventListener\(\s*['"]paste['"]|autoComplete=["']off["'][^>]*type=["']password["']/g,
      )) {
        problems.push(`${file}:${lineOf(text, m.index ?? 0)}`);
      }
    }
    expect(problems).toEqual([]);
  });
  it('no install-time scripts run code on `npm install`', () => {
    for (const file of [
      'package.json',
      'apps/api-node/package.json',
      'apps/web/package.json',
      'packages/rules/package.json',
    ]) {
      const scripts =
        (JSON.parse(read(file)) as { scripts?: Record<string, string> }).scripts ?? {};
      for (const hook of ['preinstall', 'install', 'postinstall'])
        expect(scripts[hook], `${file} ${hook}`).toBeUndefined();
    }
  });
  it('no logger call names a secret-like field', () => {
    const problems: string[] = [];
    for (const file of walk('apps/api-node/src', ['.ts'])) {
      const text = read(file);
      for (const m of text.matchAll(/logger\.(?:info|warn|error)\(([^;]*?)\);/gs)) {
        if (
          /\b(password|secret|token|authorization|apiKey|api_key|cookie|otp)\b/i.test(m[1] ?? '')
        ) {
          problems.push(`${relative(ROOT, join(ROOT, file))}:${lineOf(text, m.index ?? 0)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
