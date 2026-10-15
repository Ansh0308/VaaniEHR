/* global window, document, getComputedStyle, PopStateEvent */
// End-to-end test of Phase 2B in a real browser (system Chrome via playwright-core, no download), against the REAL
// API and PostgreSQL, using FAKE seed data only.
//
//   npm run e2e
//
// Needs: the database up and migrated, and the fake users seeded (`npm run db:up`, `npm run db:migrate`,
// `npm run seed:dev`). Sign-in passwords are read from the git-ignored data/dev-credentials.json that the seed
// generated (locally) or generated in this CI run (in CI). They are never printed, logged or put in a screenshot.
//
// Story: staff registers a fake patient and adds an allergy -> a doctor starts a session for that patient -> staff
// records consent on the session -> the doctor sees the session with consent on record -> an admin sees the chain
// verified, filters the audit log and exports a safe CSV -> a researcher sees only the anonymised log.
// Every page visited is scanned with axe (colour contrast on) and the 44px touch-target check, in English; the main
// pages are scanned again in Gujarati. Sign-in is done with the keyboard only.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChrome, killTree, scanPage } from './browser-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const WEB = 'http://127.0.0.1:4173';
const API_PORT = 4100;
const API = `http://127.0.0.1:${API_PORT}`;
const failures = [];
const steps = [];

// ---------------------------------------------------------------- environment (no secret is ever printed)
const envFile = join(root, 'apps', 'api-node', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides values already in the environment
const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const appPassword = process.env.APP_DB_PASSWORD;
if (!ownerUrl || !appPassword) {
  console.error(
    'e2e needs MIGRATION_DATABASE_URL and APP_DB_PASSWORD (locally from apps/api-node/.env via `npm run setup:env`).',
  );
  process.exit(2);
}
const credentialsFile = join(root, 'data', 'dev-credentials.json');
if (!existsSync(credentialsFile)) {
  console.error(
    'data/dev-credentials.json is missing. Run `npm run seed:dev` first (it generates the fake logins).',
  );
  process.exit(2);
}
const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'));
const EMAIL = {
  admin: 'admin@example.invalid',
  doctor: 'doctor1@example.invalid',
  staff: 'staff@example.invalid',
  researcher: 'researcher@example.invalid',
};
for (const email of Object.values(EMAIL)) {
  if (!credentials[email]) {
    console.error(
      `No generated login for ${email}. Run \`npm run seed:dev -- --reset-passwords\`.`,
    );
    process.exit(2);
  }
}
const chromePath = findChrome();
if (!chromePath) {
  console.error('No Chrome/Chromium found. Install one or set CHROME_PATH.');
  process.exit(2);
}

// the API connects as the least-privilege role, on the same database the owner URL names
const appUrl = new URL(ownerUrl);
appUrl.username = 'vaani_app';
appUrl.password = appPassword;

// ---------------------------------------------------------------- processes
const spawned = [];
function start(command, args, options) {
  const child = spawn(command, args, { stdio: 'ignore', ...options });
  spawned.push(child);
  return child;
}
function runToEnd(args, env) {
  return new Promise((done, fail) => {
    const child = spawn(npmCmd, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`npm ${args.join(' ')} exited ${code}`)),
    );
  });
}
async function waitFor(url, label) {
  for (let i = 0; i < 90; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start`);
}

// ---------------------------------------------------------------- small test helpers
const note = (message) => steps.push(message);
function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

async function newPage(browser, language = 'en') {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  await context.addInitScript(
    (value) => window.localStorage.setItem('vaaniehr.language', value),
    language,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return { context, page };
}

/** Tab (keyboard only) until the element with this id has focus. */
async function tabTo(page, id) {
  for (let i = 0; i < 20; i += 1) {
    if ((await page.evaluate(() => document.activeElement?.id)) === id) return true;
    await page.keyboard.press('Tab');
  }
  return false;
}

/** Signs in with the KEYBOARD only. The password is typed straight from the credentials file and never logged. */
async function signIn(page, role) {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  if (!(await tabTo(page, 'login-email')))
    throw new Error(`[${role}] could not reach the e-mail field by keyboard`);
  await page.keyboard.type(EMAIL[role]);
  await page.keyboard.press('Tab');
  await page.keyboard.type(credentials[EMAIL[role]]);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function signOut(page) {
  await page
    .getByRole('button', { name: /Sign out|સાઇન આઉટ/ })
    .first()
    .click();
  await page.getByRole('heading', { level: 2 }).first().waitFor();
  await page.waitForURL(/\/login/);
}

/** axe + 44px targets, then a 375px-wide check that the PAGE does not scroll sideways. */
async function scan(page, label) {
  failures.push(...(await scanPage(page, label)));
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) {
    // name the elements that stick out (ignoring ones inside a scroll container), so the cause is obvious
    const culprits = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const insideScroller = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
        }
        return false;
      };
      return [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > width + 1 && !insideScroller(el))
        .slice(0, 4)
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')}`,
        );
    });
    failures.push(
      `[${label}] page scrolls sideways by ${overflow}px at 375px width; sticking out: ${culprits.join(' | ')}`,
    );
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  note(`scanned: ${label}`);
}

// ---------------------------------------------------------------- main
let browser;
try {
  note('building the web app and starting the API and the preview server');
  await runToEnd(['run', 'build', '--workspace', 'apps/web'], {
    ...process.env,
    VITE_API_BASE_URL: API,
  });
  start(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: join(root, 'apps', 'api-node'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL: appUrl.toString(),
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: randomBytes(32).toString('hex'),
      CORS_ORIGIN: WEB,
      SIMULATED_DATA_ONLY: 'true',
      LOGIN_RATE_LIMIT_MAX: '1000', // this run signs in many times from one address
    },
  });
  start(
    npmCmd,
    [
      'run',
      'preview',
      '--workspace',
      'apps/web',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '4173',
      '--strictPort',
    ],
    { cwd: root, shell: process.platform === 'win32' },
  );
  await waitFor(`${API}/health`, 'the API');
  await waitFor(WEB, 'the web app');
  browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });

  const phoneTail = Math.max(100, Math.floor(Math.random() * 999999));
  const phone = `0000${String(phoneTail).padStart(6, '0')}`;
  const patientName = 'Fake E2E Patient';
  const allergy = 'Drug-E2E (FAKE)';
  let sessionId = '';

  // ------------------------------------------------ staff: login page, register a patient, add an allergy
  {
    const { context, page } = await newPage(browser);
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await scan(page, 'en login');
    await signIn(page, 'staff');
    check(/\/patients$/.test(page.url()), 'staff lands on /patients');
    await page.getByRole('heading', { name: 'Patients', level: 1 }).waitFor();
    await scan(page, 'en patients (empty)');

    await page.getByLabel('Phone number').fill(phone);
    await page.getByText('No patient with this number').first().waitFor();
    await scan(page, 'en patients (not found)');
    await page.getByRole('button', { name: 'Register patient' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Register a new patient' });
    await dialog.waitFor();
    check(
      (await dialog.getByLabel('Phone number').inputValue()) === phone,
      'register dialog shows the phone',
    );
    await dialog.getByLabel('Name (optional)').fill(patientName);
    await scan(page, 'en register dialog');
    await page.keyboard.press('Enter'); // submits the form from the keyboard
    await page.getByRole('article').waitFor();
    check(
      (await page.getByRole('article').textContent()).includes(patientName),
      'the new patient is shown',
    );

    await page.getByLabel(/Add an allergy/).fill(allergy);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Save allergies' }).click();
    await page.getByText('Allergies saved').first().waitFor();
    await scan(page, 'en patients (with allergy)');

    // a page for another role shows a clear 403 page (the API refuses the data too). A full page load would drop the
    // in-memory token on purpose, so move inside the app the way a pasted in-app link would.
    await page.evaluate(() => window.history.pushState({}, '', '/admin/audit'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await page.getByRole('heading', { name: 'Your role cannot open this page' }).waitFor();
    await scan(page, 'en 403');
    await signOut(page);
    await context.close();
  }

  // ------------------------------------------------ doctor: find the patient, start a session
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'doctor');
    await page.getByRole('heading', { name: 'Doctor dashboard', level: 1 }).waitFor();
    check(
      await page.getByText('Not available until the ClinicOS integration').first().isVisible(),
      'the queue is a labelled placeholder',
    );
    await scan(page, 'en doctor dashboard');
    await page.getByLabel('Phone number').fill(phone);
    await page.getByText(allergy).first().waitFor(); // instant match shows the allergy chip
    await page.getByRole('button', { name: 'Start session' }).click();
    await page.waitForURL(/\/consult\/[0-9a-f-]{36}\/consent$/);
    sessionId = /consult\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
    check(sessionId.length === 36, 'the session id is in the consent link');
    await page.getByRole('heading', { name: 'Consent', level: 1 }).waitFor();
    check(
      await page.getByText('Recording is off').first().isVisible(),
      'recording is off before consent',
    );
    check(await page.locator('section[lang="en"]').isVisible(), 'English notice shown');
    check(
      await page.locator('section[lang="gu"]').isVisible(),
      'Gujarati notice shown side by side',
    );
    await scan(page, 'en consent (before consent, doctor)');
    await signOut(page);
    await context.close();
  }

  // ------------------------------------------------ staff: record consent on the session
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'staff');
    await page.getByLabel(/Session code/).fill(sessionId);
    await page.getByRole('button', { name: 'Open consent page' }).click();
    await page.getByRole('heading', { name: 'Consent', level: 1 }).waitFor();
    // keyboard: focus each switch and toggle with Space
    await page.getByRole('switch', { name: /Audio recording/ }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('switch', { name: /AI processing/ }).focus();
    await page.keyboard.press('Space');
    check(
      (await page
        .getByRole('switch', { name: /WhatsApp summary/ })
        .getAttribute('aria-checked')) === 'false',
      'WhatsApp stays off (independent switches)',
    );
    // saving without saying who confirmed is refused, with a focused error summary
    await page.getByRole('button', { name: 'Save consent' }).click();
    await page.getByRole('alert', { name: 'Consent was not saved' }).waitFor();
    check(
      (await page.evaluate(() => document.activeElement?.getAttribute('role'))) === 'alert',
      'the error summary takes focus',
    );
    await scan(page, 'en consent (error summary)');
    await page.getByRole('radio', { name: /Staff entered it/ }).check();
    await page.getByRole('button', { name: 'Save consent' }).click();
    await page.getByText('Recording consent is on record').first().waitFor();
    await scan(page, 'en consent (on record)');
    const historyRows = await page
      .getByRole('table', { name: 'Consent history for this session' })
      .getByRole('row')
      .count();
    check(historyRows === 3, `consent history has 2 events (saw ${historyRows - 1})`);
    await signOut(page);
    await context.close();
  }

  // ------------------------------------------------ doctor sees the session with consent on record
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'doctor');
    const row = page.getByRole('row').filter({ hasText: patientName }).first();
    await row.waitFor();
    check(
      (await row.textContent()).includes('Recording consent on record'),
      'doctor sees consent on record',
    );
    await scan(page, 'en doctor dashboard (with session)');
    await context.close();
  }

  // ------------------------------------------------ admin: chain, filters, export
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'admin');
    check(/\/admin\/audit$/.test(page.url()), 'admin lands on the audit log');
    await page.getByText('Chain verified').first().waitFor();
    await page.getByLabel('Action').selectOption('CONSENT_GRANTED');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await page
      .getByRole('table', { name: 'Audit log' })
      .getByText('Consent given')
      .first()
      .waitFor();
    const grantedRows = await page
      .getByRole('table', { name: 'Audit log' })
      .getByRole('row')
      .count();
    check(grantedRows >= 3, 'the action filter shows the consent events');
    await scan(page, 'en audit (admin)');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    const lines = csv.trim().split('\r\n');
    check(
      lines[0] ===
        'seq,ts,action,actor_user_id,actor_role,resource_type,resource_id,session_id,request_id,row_hash',
      'CSV has the identifier-only header',
    );
    check(
      lines.length >= 3 && lines.slice(1).every((l) => l.split(',')[2] === 'CONSENT_GRANTED'),
      'CSV follows the filter',
    );
    check(
      !csv.includes('@') && !csv.includes(patientName) && !csv.includes(phone),
      'CSV holds no e-mail, name or phone',
    );
    check(
      lines.slice(1).every((l) => l.split(',').every((cell) => !/^[=+\-@\t\r]/.test(cell))),
      'no CSV cell can run as a spreadsheet formula',
    );
    await page
      .getByText(/Exported rows: \d+/)
      .first()
      .waitFor();

    // the export is itself in the audit log
    await page.getByLabel('Action').selectOption('AUDIT_EXPORTED');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await page
      .getByRole('table', { name: 'Audit log' })
      .getByText('Audit log exported')
      .first()
      .waitFor();
    check(true, 'the export appears in the audit log');
    await scan(page, 'en audit (export recorded)');
    await context.close();
  }

  // ------------------------------------------------ researcher: anonymised view only
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'researcher');
    await page.getByRole('table', { name: 'Audit log' }).waitFor();
    check(
      (await page.getByRole('button', { name: 'Export CSV' }).count()) === 0,
      'researcher cannot export',
    );
    check((await page.getByLabel('User ID').count()) === 0, 'researcher cannot filter by user');
    check(
      (await page.getByRole('columnheader', { name: 'User' }).count()) === 0,
      'researcher sees no user column',
    );
    await scan(page, 'en audit (researcher)');
    await context.close();
  }

  // ------------------------------------------------ Gujarati pass over the main pages
  {
    const gu = await newPage(browser, 'gu');
    await gu.page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    check(
      (await gu.page.evaluate(() => document.documentElement.lang)) === 'gu',
      'Gujarati sets <html lang>',
    );
    await scan(gu.page, 'gu login');
    await signIn(gu.page, 'doctor');
    await gu.page.getByRole('heading', { level: 1 }).waitFor();
    await scan(gu.page, 'gu doctor dashboard');
    await gu.page.goto(`${WEB}/design`, { waitUntil: 'networkidle' });
    await scan(gu.page, 'gu design');
    await gu.context.close();

    const guStaff = await newPage(browser, 'gu');
    await signIn(guStaff.page, 'staff');
    await guStaff.page.getByLabel('ફોન નંબર').first().fill(phone);
    await guStaff.page.getByRole('article').waitFor();
    await scan(guStaff.page, 'gu patients (with match)');
    await guStaff.page.getByLabel(/સત્ર કોડ/).fill(sessionId);
    await guStaff.page.getByRole('button', { name: 'સંમતિ પાનું ખોલો' }).click();
    await guStaff.page.locator('section[lang="gu"]').waitFor();
    await scan(guStaff.page, 'gu consent');
    await guStaff.context.close();

    const guAdmin = await newPage(browser, 'gu');
    await signIn(guAdmin.page, 'admin');
    await guAdmin.page.getByRole('table').waitFor();
    await scan(guAdmin.page, 'gu audit (admin)');
    await guAdmin.context.close();
  }

  // ------------------------------------------------ reduced motion
  {
    const { context, page } = await newPage(browser);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    const moving = await page.evaluate(
      () =>
        [...document.querySelectorAll('*')].filter((el) => {
          const s = getComputedStyle(el);
          return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.011;
        }).length,
    );
    check(moving === 0, `no animation under reduced motion (saw ${moving})`);
    await context.close();
  }
} catch (error) {
  // Playwright error text can quote locators but never the typed values; print only the message's first line.
  failures.push(`stopped by an error: ${String(error?.message ?? error).split('\n')[0]}`);
} finally {
  await browser?.close();
  for (const child of spawned) killTree(child);
}

console.log(`\ne2e steps completed: ${steps.length}`);
for (const step of steps) console.log(`  - ${step}`);
if (failures.length > 0) {
  console.error(
    `\ne2e FAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join('\n')}`,
  );
  process.exit(1);
}
console.log('\ne2e passed');
