/* global window, document, getComputedStyle, PopStateEvent */
// End-to-end test of Phase 2B in a real browser (system Chrome via playwright-core, no download), against the REAL
// API and PostgreSQL, using FAKE seed data only.
//
//   npm run e2e
//
// Needs: the database SERVER up (`npm run db:up`) and MIGRATION_DATABASE_URL / APP_DB_PASSWORD. The run NEVER touches
// the real development database: it creates its own throwaway database (vaaniehr_e2e_<random>), migrates and seeds it,
// keeps the generated fake logins in a temp file, and drops both in a finally block. Passwords are never printed,
// logged or put in a screenshot.
//
// Story: staff registers a fake patient and adds an allergy -> a doctor starts a session for that patient -> staff
// records consent on the session -> the doctor sees the session with consent on record -> an admin sees the chain
// verified, filters the audit log and exports a safe CSV -> a researcher sees only the anonymised log.
// Every page visited is scanned with axe (colour contrast on) and the 44px touch-target check, in English; the main
// pages are scanned again in Gujarati. Sign-in is done with the keyboard only.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { findChrome, killTree, scanPage } from './browser-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const WEB = 'http://127.0.0.1:4173';
const API_PORT = 4100;
const API = `http://127.0.0.1:${API_PORT}`;
const ASR_PORT = 8100;
const ASR = `ws://127.0.0.1:${ASR_PORT}`;
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
// the throwaway database and the temp file for its fake logins (the real data/dev-credentials.json is never read or written)
const dbName = `vaaniehr_e2e_${randomBytes(4).toString('hex')}`;
const credentialsFile = join(tmpdir(), `${dbName}-credentials.json`);
let credentials = {};
const EMAIL = {
  admin: 'admin@example.invalid',
  doctor: 'doctor1@example.invalid',
  staff: 'staff@example.invalid',
  researcher: 'researcher@example.invalid',
};
const chromePath = findChrome();
if (!chromePath) {
  console.error('No Chrome/Chromium found. Install one or set CHROME_PATH.');
  process.exit(2);
}

// the API connects as the least-privilege role, on the same database the owner URL names
const throwawayOwnerUrl = new URL(ownerUrl);
throwawayOwnerUrl.pathname = `/${dbName}`;
const appUrl = new URL(throwawayOwnerUrl);
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

/** A mono 16 kHz 16-bit WAV of `seconds` seconds: a quiet 220 Hz tone. The mock engine ignores the content. */
function makeWav(seconds) {
  const rate = 16000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  }
  return buffer;
}

/** Moves inside the app the way an in-app link would (a full page load would drop the in-memory token). */
async function goInApp(page, path) {
  await page.evaluate((to) => window.history.pushState({}, '', to), path);
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
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

// ---------------------------------------------------------------- throwaway database helpers
let databaseCreated = false;
/** Runs one statement on the database SERVER (as the owner role) without touching any application database. */
async function adminQuery(sql) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Runs one statement on the THROWAWAY application database as the owner role (test set-up only; fake data). */
async function appQuery(sql, params = []) {
  const client = new pg.Client({ connectionString: throwawayOwnerUrl.toString() });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------- main
let browser;
let asrDataDir = '';
try {
  // ------------------------------------------------ throwaway database: created, migrated, seeded, dropped in `finally`
  note(`creating the throwaway database ${dbName}`);
  await adminQuery(`CREATE DATABASE ${dbName}`);
  databaseCreated = true;
  const throwawayEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: throwawayOwnerUrl.toString(),
    DEV_CREDENTIALS_FILE: credentialsFile,
    SIMULATED_DATA_ONLY: 'true',
  };
  await runToEnd(['run', 'db:migrate'], throwawayEnv);
  await runToEnd(['run', 'seed:dev'], throwawayEnv);
  credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'));
  for (const email of Object.values(EMAIL)) {
    if (!credentials[email]) throw new Error(`the seed made no login for ${email}`);
  }

  note(
    'building the web app and starting the API, the speech service (mock engine) and the preview server',
  );
  await runToEnd(['run', 'build', '--workspace', 'apps/web'], {
    ...process.env,
    VITE_API_BASE_URL: API,
    VITE_ASR_WS_URL: ASR,
    VITE_ASR_HTTP_URL: `http://127.0.0.1:${ASR_PORT}`,
  });
  // the speech service runs with the MOCK engine only: no key, no vendor call, no network beyond this machine
  const internalSecret = randomBytes(32).toString('hex');
  const asrData = mkdtempSync(join(tmpdir(), 'vaani-asr-'));
  asrDataDir = asrData;
  const asrEnv = { ...process.env };
  for (const secret of ['SARVAM_API_KEY', 'HF_TOKEN', 'LLM_API_KEY']) delete asrEnv[secret];
  const venvPython = join(
    root,
    'apps',
    'asr-py',
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  );
  start(
    existsSync(venvPython) ? venvPython : 'python',
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(ASR_PORT)],
    {
      cwd: join(root, 'apps', 'asr-py'),
      env: {
        ...asrEnv,
        SIMULATED_DATA_ONLY: 'true',
        ASR_PY_PORT: String(ASR_PORT),
        ASR_ENABLE_MOCK: 'true',
        LLM_PROVIDER: 'mock', // the test-mode sample extraction: no language model, no network
        LLM_ALLOW_REAL_DATA: 'false',
        ASR_DEFAULT_ENGINE: 'mock',
        ASR_VAD: 'none',
        ALLOWED_ORIGINS: WEB,
        API_NODE_URL: API,
        INTERNAL_SERVICE_SECRET: internalSecret,
        AUDIO_MASTER_KEY: randomBytes(32).toString('hex'),
        ASR_DATA_DIR: asrData,
      },
    },
  );
  start(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: join(root, 'apps', 'api-node'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL: appUrl.toString(),
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: randomBytes(32).toString('hex'),
      INTERNAL_SERVICE_SECRET: internalSecret,
      CORS_ORIGIN: WEB,
      SIMULATED_DATA_ONLY: 'true',
      LOGIN_RATE_LIMIT_MAX: '1000', // this run signs in many times from one address
      // the FAKE toy pathways, for the read-only pathway viewer (never real content)
      PATHWAYS_DIR: join(root, 'packages', 'rules', 'fixtures', 'pathways'),
      PATHWAYS_ALLOW_TEST: 'true',
      PATHWAYS_SLOT_MAP: join(
        root,
        'packages',
        'rules',
        'fixtures',
        'pathways',
        '_toy',
        'slot-map.json',
      ),
      // the FAKE toy concept list: its ids match the toy slot map (the owner's real draft list is never read here)
      CONCEPTS_FILE: join(root, 'packages', 'rules', 'fixtures', 'concepts', 'toy-concepts.json'),
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
  await waitFor(`http://127.0.0.1:${ASR_PORT}/health`, 'the speech service');
  await waitFor(WEB, 'the web app');
  // Chromium plays a generated WAV as the microphone (no real device, no prompt)
  const wavFile = join(asrData, 'fake-mic.wav');
  writeFileSync(wavFile, makeWav(12));
  browser = await chromium.launch({
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavFile}`,
    ],
  });

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

  // ------------------------------------------------ doctor records: consent gate, token in the first message, draft transcript
  {
    const { context, page } = await newPage(browser);
    await context.grantPermissions(['microphone']);
    const sockets = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));
    await signIn(page, 'doctor');
    await goInApp(page, `/consult/${sessionId}`);
    await page.getByRole('heading', { name: 'Consultation', level: 1 }).waitFor();
    await page.getByText('Consent on record: audio recording and AI processing.').waitFor();
    await scan(page, 'en consultation (ready)');
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.getByText('Namaste, tav kyarthi che').waitFor({ timeout: 30_000 });
    check(
      await page.getByText('Draft — doctor must review').first().isVisible(),
      'the transcript carries the draft label',
    );
    const item = page.getByRole('listitem').filter({ hasText: 'Namaste, tav kyarthi che' });
    check(
      await item.getByRole('radio', { name: 'Unknown' }).isChecked(),
      'a new segment starts with an unknown speaker',
    );
    await item.getByRole('radio', { name: 'Doctor' }).check();
    check(
      await item.getByRole('radio', { name: 'Doctor' }).isChecked(),
      'the doctor sets the speaker',
    );
    check(!(await page.locator('body').innerText()).match(/confidence/i), 'no confidence is shown');
    await scan(page, 'en consultation (recording, draft transcript)');
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByText('Ready', { exact: true }).waitFor({ timeout: 30_000 });
    check(
      sockets.length === 1 && sockets[0] === `${ASR}/ws/sessions/${sessionId}/audio`,
      'one WebSocket to the speech service, and the token is not in its URL',
    );
    // ---- Phase 5B: facts. Nothing runs until the doctor presses the button; the mock provider gives a labelled sample.
    await page.getByText('All changes saved').waitFor({ timeout: 30_000 });
    await page.getByText('Test mode - sample extraction').waitFor();
    check(
      (await page.getByRole('group', { name: /^Symptoms:/ }).count()) === 0,
      'no fact appears before the doctor presses Extract facts',
    );
    await page.getByRole('button', { name: 'Extract facts' }).click();
    const factA = page.getByRole('group', { name: 'Symptoms: Namaste, tav kyarthi' });
    await factA.waitFor({ timeout: 30_000 });
    check(await factA.getByText('Heard').isVisible(), 'an extracted fact starts as Heard');
    await scan(page, 'en consultation (facts heard)');
    await factA.hover();
    await page.getByRole('note').waitFor();
    check(
      (await page.locator('mark').first().innerText()) === 'Namaste, tav kyarthi',
      'hovering a fact highlights its words in the transcript',
    );
    await factA.getByRole('button', { name: /^Confirm Namaste/ }).click();
    await factA.getByText('Confirmed', { exact: true }).waitFor();
    // remaining Phase 5 items: the (toy, unreviewed) list suggests a concept for the fact; the doctor confirms it; the
    // question panel moves on because the symptom slot is now known
    const questionPanel = page.getByRole('region', { name: 'Suggested questions' });
    await questionPanel.getByText('Toy question: is toy symptom 1 present?').waitFor();
    await factA.getByText('Suggested concept: toy symptom one (unreviewed list)').waitFor();
    check(
      (await factA.innerText()).search(/%|score|confidence/i) < 0,
      'the concept suggestion shows no score or percentage',
    );
    check(
      (await page.getByRole('button', { name: 'Confirm concept' }).count()) >= 1 &&
        (await factA.evaluate((el) => el.textContent.includes('Concept: toy symptom one'))) ===
          false,
      'a concept is only suggested until the doctor confirms it',
    );
    await scan(page, 'en consultation (concept suggested)');
    await factA.getByRole('button', { name: 'Confirm concept' }).click();
    await factA.getByText('Concept: toy symptom one (unreviewed list)').waitFor();
    await questionPanel.getByText('Toy question: is toy symptom 2 present?').waitFor();
    await scan(page, 'en consultation (concept confirmed, question moved on)');
    // edit the words the OTHER fact came from: that fact becomes stale
    const seg2 = page.getByRole('listitem').filter({ hasText: 'Drug-A twice a day' });
    await seg2.getByRole('button', { name: /^Edit segment/ }).click();
    await page.getByLabel('Text of segment 2').fill('Something else entirely');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Text changed - re-check').first().waitFor({ timeout: 30_000 });
    await scan(page, 'en consultation (facts, one stale)');
    await goInApp(page, '/doctor'); // leave and come back (a reload would sign the in-memory login out)
    await page.getByRole('heading', { name: 'Doctor dashboard', level: 1 }).waitFor();
    await goInApp(page, `/consult/${sessionId}`);
    await page.getByRole('group', { name: 'Symptoms: Namaste, tav kyarthi' }).waitFor();
    check(
      await page
        .getByRole('group', { name: 'Symptoms: Namaste, tav kyarthi' })
        .getByText('Confirmed', { exact: true })
        .isVisible(),
      'the confirmation was stored (it survives a reload)',
    );
    const stored = await page.evaluate(() => [
      ...Object.keys(window.localStorage),
      ...Object.keys(window.sessionStorage),
    ]);
    check(
      stored.every((key) => key === 'vaaniehr.language'),
      'nothing but the language choice is in browser storage',
    );
    await context.close();
  }

  // ------------------------------------------------ doctor: pathway aids on the FAKE toy pathways (Phase 6C)
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'doctor');
    const [owner] = await appQuery(
      'SELECT clinicos_clinic_id AS clinic, clinicos_doctor_id AS doctor FROM consultation_session WHERE id = $1',
      [sessionId],
    );
    const addFact = (concept) =>
      appQuery(
        `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at,
           confirmed_by, concept_id, concept_status, concept_confirmed_by, concept_confirmed_at)
         VALUES ($1,$2,'duration',$3,'manual','confirmed','manual', now(), $4, $5, 'confirmed', $4, now())`,
        [sessionId, owner.clinic, `toy fact ${concept}`, owner.doctor, concept],
      );
    const open = async () => {
      await goInApp(page, '/doctor');
      await page.getByRole('heading', { name: 'Doctor dashboard', level: 1 }).waitFor();
      await goInApp(page, `/consult/${sessionId}`);
    };
    await open();
    const questions = page.getByRole('region', { name: 'Suggested questions' });
    await questions.getByText('Test pathway - not clinical').waitFor();
    await questions.getByText('Toy question: is toy symptom 2 present?').waitFor(); // symptom 1 is known since the concept was confirmed
    check(
      (await page.getByTestId('red-flag-banner').count()) === 0,
      'no red-flag notice before a red-flag fact is confirmed',
    );
    await questions.getByRole('button', { name: 'Asked' }).click();
    await questions.getByText(/1 handled so far/).waitFor();

    // two confirmed facts that carry toy concept ids: a symptom and the red-flag slot
    await addFact('toy_c_toy_symptom_1');
    await addFact('toy_c_toy_redflag_1');
    await open();
    const banner = page.getByTestId('red-flag-banner');
    await banner.waitFor();
    check(
      (await banner.getAttribute('role')) === 'alert' &&
        (await banner.innerText()).includes('Pathway red-flag condition met - doctor to review'),
      'the red-flag notice is an alert with the neutral wording',
    );
    check(
      !/treat|prescrib|diagnos/i.test(await banner.innerText()),
      'the red-flag notice gives no advice',
    );
    await scan(page, 'en consultation (pathway aids, red flag)');
    await banner.getByRole('button', { name: 'Acknowledge' }).click();
    await banner.waitFor({ state: 'detached' });
    await questions.getByText(/makes no further suggestions/).waitFor();

    const candidatesPanel = page.getByRole('region', { name: 'Candidate conditions' });
    await candidatesPanel.getByText('Suggestions are aids; the doctor decides.').waitFor();
    await candidatesPanel
      .locator('[data-candidate="toy_condition_a"]')
      .getByRole('button', { name: 'Select as working condition' })
      .click();
    await candidatesPanel.getByTestId('working-condition').waitFor();
    check(
      (await candidatesPanel.getByTestId('working-condition').innerText()).includes(
        'Toy condition A',
      ),
      'the working condition is shown after it is selected',
    );
    check(
      !/%|confidence/i.test(await candidatesPanel.innerText()),
      'the candidates show no percentage or confidence',
    );
    await scan(page, 'en consultation (pathway aids, working condition)');
    await signOut(page);
    await context.close();
  }

  // ------------------------------------------------ staff withdraws consent: heard and stale facts go, confirmed stays
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'staff');
    await page.getByLabel(/Session code/).fill(sessionId);
    await page.getByRole('button', { name: 'Open consent page' }).click();
    await page.getByRole('heading', { name: 'Consent', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Withdraw consent' }).click();
    await page.getByRole('dialog').getByRole('radio', { name: /Staff/ }).first().check();
    await page.getByRole('button', { name: 'Withdraw all consent' }).click();
    await page.getByText('Consent withdrawn').first().waitFor();
    await signOut(page);
    await context.close();
    const doctor = await newPage(browser);
    await signIn(doctor.page, 'doctor');
    await goInApp(doctor.page, `/consult/${sessionId}`);
    await doctor.page.getByRole('group', { name: 'Symptoms: Namaste, tav kyarthi' }).waitFor();
    check(
      (await doctor.page.getByText('Text changed - re-check').count()) === 0 &&
        (await doctor.page.getByRole('group', { name: /^Symptoms:/ }).count()) === 1,
      'withdrawal removed the heard and stale facts and kept the confirmed one',
    );
    const afterQuestions = doctor.page.getByRole('region', { name: 'Suggested questions' });
    await afterQuestions.getByText(/consent is not on record/).waitFor();
    check(
      (await afterQuestions.getByRole('button', { name: 'Asked' }).count()) === 0 &&
        (await doctor.page.getByRole('button', { name: 'Select as working condition' }).count()) ===
          0,
      'after withdrawal the pathway panels offer nothing',
    );
    check(
      (await afterQuestions.innerText()).includes('Pathway red-flag condition acknowledged') &&
        (
          await doctor.page.getByRole('region', { name: 'Candidate conditions' }).innerText()
        ).includes('Working condition: Toy condition A'),
      'the acknowledged red flag and the working condition are kept and shown read only',
    );
    await scan(doctor.page, 'en consultation (after withdrawal, confirmed fact kept)');
    await doctor.context.close();
  }

  // ------------------------------------------------ doctor and admin: the read-only pathway viewer (toy pathways)
  for (const role of ['doctor', 'admin']) {
    const { context, page } = await newPage(browser);
    await signIn(page, role);
    await goInApp(page, '/admin/pathways');
    await page.getByRole('heading', { name: 'Guideline pathways', level: 1 }).waitFor();
    await page.getByText('Draft - not clinically reviewed').first().waitFor();
    await page.getByText('[TOY-GU] Toy question: is toy symptom 1 present?').first().waitFor();
    check(
      (await page.getByRole('textbox').count()) === 0,
      `the pathway viewer is read only for the ${role} (no text box)`,
    );
    check(
      (await page.getByText('No source sentence recorded yet').count()) > 0,
      'the viewer says plainly when a node has no source sentence',
    );
    await scan(page, `en pathways (${role}, toy)`);
    await signOut(page);
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

  // ------------------------------------------------ admin adds a medicine and a clinic-wide template; the doctor loads it
  const medicineName = `Drug-E2E-${phoneTail} (FAKE)`;
  const templateName = `E2E clinic-wide template ${phoneTail} (FAKE)`;
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'admin');
    await goInApp(page, '/admin/medicines');
    await page.getByRole('heading', { name: 'Medicine master', level: 1 }).waitFor();
    await scan(page, 'en medicine master');
    await page.getByRole('button', { name: 'Add medicine' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add a medicine' });
    await dialog.waitFor();
    await dialog.getByLabel(/Generic name/).fill(medicineName);
    await dialog.getByLabel('Strength').fill('1 mg');
    await dialog.getByLabel('Dose form').fill('Tablet');
    await dialog.getByLabel('Source (required)').fill('e2e fixture (fake)');
    await scan(page, 'en medicine dialog');
    await dialog.getByRole('button', { name: 'Save medicine' }).click();
    await page.getByText('Medicine added').first().waitFor();

    await goInApp(page, '/admin/templates');
    await page.getByRole('heading', { name: 'Prescription templates', level: 1 }).waitFor();
    await scan(page, 'en template list (admin)');
    await page.getByRole('button', { name: 'New template' }).first().click();
    await page.getByRole('heading', { name: 'New template', level: 1 }).waitFor();
    await page.getByLabel('Template name (required)').fill(templateName);
    await page.getByRole('radio', { name: /Clinic-wide/ }).check();
    await page.getByRole('button', { name: 'Add medicine' }).click();
    await page.getByRole('combobox', { name: 'Medicine' }).fill(medicineName);
    const option = page.getByRole('option').filter({ hasText: medicineName });
    await option.waitFor();
    check(
      (await option.textContent()).includes('NLEM 2022 - not clinically reviewed'),
      'a new medicine is offered as not clinically reviewed',
    );
    await option.click();
    await page.getByLabel('Frequency').selectOption('BD');
    await page.getByLabel('Dose').fill('1 tablet');
    await scan(page, 'en template builder');
    await page.getByRole('button', { name: 'Save template' }).click();
    await page.getByRole('heading', { name: 'Prescription templates', level: 1 }).waitFor();
    await page.getByText(templateName).first().waitFor();
    await context.close();
  }
  {
    const { context, page } = await newPage(browser);
    await signIn(page, 'doctor');
    await goInApp(page, '/admin/templates');
    await page.getByText(templateName).first().waitFor();
    check(
      (await page.getByRole('row').filter({ hasText: templateName }).count()) === 1,
      'the doctor sees the clinic-wide template',
    );
    await page.getByRole('button', { name: `Load ${templateName}` }).click();
    const loaded = page.getByRole('dialog');
    await loaded.getByRole('listitem').first().waitFor();
    const text = await loaded.textContent();
    check(text.includes(medicineName), 'the loaded template shows the medicine');
    check(text.includes('Twice daily (BD)'), 'the loaded template shows the frequency label');
    check(text.includes('Not reviewed'), 'the loaded medicine is marked not reviewed');
    await scan(page, 'en template loaded (doctor)');
    await page.keyboard.press('Escape');
    // the doctor cannot edit the admin's template: no edit button on its row
    check(
      (await page.getByRole('button', { name: `Edit ${templateName}` }).count()) === 0,
      "the doctor has no edit button on the admin's template",
    );
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
  failures.push(
    `stopped by an error: ${String(error?.message ?? error)
      .split('\n')
      .slice(0, 6)
      .join(' / ')}`,
  );
} finally {
  await browser?.close();
  for (const child of spawned) killTree(child);
  // always remove what this run made: the throwaway database and its login file
  rmSync(credentialsFile, { force: true });
  rmSync(asrDataDir, { recursive: true, force: true });
  if (databaseCreated) {
    await new Promise((r) => setTimeout(r, 1500)); // let the API's connections close first
    try {
      await adminQuery(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      console.log(`dropped the throwaway database ${dbName}`);
    } catch (error) {
      console.error(
        `COULD NOT DROP ${dbName}: ${String(error?.message ?? error).split(String.fromCharCode(10))[0]} (drop it by hand)`,
      );
      failures.push(`the throwaway database ${dbName} was not dropped`);
    }
  }
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
