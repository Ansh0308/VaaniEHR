/* global window, document, getComputedStyle, PopStateEvent */
// Browser accessibility check for /design (NFR-UX-01, NFR-UX-02): axe-core with colour contrast, 44px touch
// targets, no horizontal scroll at phone width, and reduced-motion, in English and Gujarati.
// Uses playwright-core with a system Chrome/Chromium (no browser download). Not part of `npm run check`;
// run it with `npm run a11y` (CI job "a11y"). Set CHROME_PATH to override the browser location.
// The Phase 3B pages (medicine master, template list, template builder) are scanned signed in, against a MOCKED API
// (fake data, no database), at 1280px and 375px, in English and Gujarati. The rest of the signed-in pages are covered
// by `npm run e2e` (same scan, with the real API running).
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChrome, killTree, scanPage } from './browser-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
  return new Promise((done, fail) => {
    const child = spawn(npm, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`npm ${args.join(' ')} exited ${code}`)),
    );
  });
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview server did not start');
}

const chromePath = findChrome();
if (!chromePath) {
  console.error('No Chrome/Chromium found. Install one or set CHROME_PATH.');
  process.exit(2);
}

await run(['run', 'build', '--workspace', 'apps/web']);
const server = spawn(
  npm,
  [
    'run',
    'preview',
    '--workspace',
    'apps/web',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--strictPort',
  ],
  { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' },
);
const failures = [];

// ---------------------------------------------------------------- mocked API for the signed-in Phase 3B pages
const MED = {
  id: '5eed0000-0000-4000-8000-000000000201',
  genericName: 'Drug-A (FAKE)',
  strength: '500 mg',
  doseForm: 'Tablet',
  route: null,
  therapeuticCategory: 'Section One > Group A',
  nlemYear: 2022,
  snomedCode: null,
  atcCode: null,
  source: 'a11y fixture',
  sourcePage: 27,
  sourcePagePrinted: 26,
  nlemRef: null,
  healthcareLevels: null,
  sourceNotes: null,
  alsoListedIn: [],
  reviewStatus: 'not_reviewed',
  reviewedOn: null,
  reviewedBy: null,
  retired: false,
  brands: [{ id: 'b1', brandName: 'Brand-X', manufacturer: null, source: 's' }],
};
const TEMPLATE = {
  id: '5eed0000-0000-4000-8000-000000000301',
  name: 'Demo clinic-wide template (FAKE)',
  visibility: 'clinic',
  ownerId: '5eed0000-0000-4000-8000-000000000012',
  ownerName: 'Fake doctor',
  ownedByMe: false,
  itemCount: 1,
  retired: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  canEdit: false,
};
function mockData(method, path, role) {
  if (method === 'POST' && path === '/auth/login')
    return {
      accessToken: 'fake-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: {
        id: '5eed0000-0000-4000-8000-000000000011',
        name: `Fake ${role}`,
        role,
        clinicId: '5eed0000-0000-4000-8000-000000000001',
        status: 'approved',
        isSimulated: true,
      },
    };
  if (path === '/medicines/categories') return { categories: [{ name: 'Section One', count: 1 }] };
  if (path === '/medicines') return { items: [MED], total: 1, limit: 25, offset: 0 };
  if (path === '/templates') return { items: [TEMPLATE], total: 1, limit: 25, offset: 0 };
  return {};
}
async function mockApi(context, role) {
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': BASE,
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    return route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: mockData(request.method(), path, role) }),
    });
  });
}
/** Signs in through the real login form, then moves inside the app (a full load would drop the in-memory token). */
async function signInMocked(page, lang) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('#login-email').fill('user@example.invalid');
  await page.locator('input[type=password]').fill('fake-password');
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) {
    await page.click(`button[lang="${lang}"]`);
  }
}
async function goInApp(page, path) {
  await page.evaluate((to) => window.history.pushState({}, '', to), path);
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
}
/** axe + 44px targets at desktop width, then no sideways page scroll at phone width. */
async function scanBoth(page, label) {
  const problems = await scanPage(page, label);
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) problems.push(`[${label}] page scrolls sideways by ${overflow}px at 375px`);
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log(`  scanned ${label}: ${problems.length} problem(s)`);
  return problems;
}

try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });

  for (const lang of ['en', 'gu']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(
      (value) => window.localStorage.setItem('vaaniehr.language', value),
      lang,
    );
    const page = await context.newPage();
    await page.goto(`${BASE}/design`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if ((await page.evaluate(() => document.documentElement.lang)) !== lang) {
      await page.click(`button[lang="${lang}"]`); // fall back to the toggle
    }

    const problems = await scanPage(page, `${lang} /design`);
    failures.push(...problems);

    await page.setViewportSize({ width: 375, height: 812 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) failures.push(`[${lang}] horizontal scroll of ${overflow}px at 375px width`);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.011;
        })
        .map((el) => el.className.toString().slice(0, 40)),
    );
    for (const m of moving) failures.push(`[${lang}] animates under reduced motion: ${m}`);

    console.log(
      `[${lang}] problems: ${problems.length}, overflow: ${overflow}px, animated under reduce: ${moving.length}`,
    );
    await context.close();
  }

  // Phase 3B pages, signed in against the mocked API
  const pages3b = [
    { role: 'admin', path: '/admin/medicines', name: 'medicine master', ready: 'table' },
    { role: 'doctor', path: '/admin/templates', name: 'template list', ready: 'table' },
    { role: 'doctor', path: '/admin/templates/new', name: 'template builder', ready: 'button' },
  ];
  for (const lang of ['en', 'gu']) {
    for (const spec of pages3b) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(
        (value) => window.localStorage.setItem('vaaniehr.language', value),
        lang,
      );
      await mockApi(context, spec.role);
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      await signInMocked(page, lang);
      await goInApp(page, spec.path);
      if (spec.ready === 'table') {
        try {
          await page.getByRole('table').first().waitFor();
        } catch {
          const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
          failures.push(`[${lang} ${spec.name}] no table appeared; page says: ${text}`);
          await context.close();
          continue;
        }
      } else {
        // builder: add one line so the medicine field and its options are on the page
        await page.getByRole('heading', { level: 1 }).waitFor();
        await page.locator('#add-item').click();
        const input = page.getByRole('combobox').first();
        await input.fill('drug');
        await page.getByRole('option').first().waitFor();
      }
      failures.push(...(await scanBoth(page, `${lang} ${spec.name}`)));
      await context.close();
    }
  }
  await browser.close();
} finally {
  killTree(server);
}

if (failures.length > 0) {
  console.error(`\na11y FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('a11y passed');
