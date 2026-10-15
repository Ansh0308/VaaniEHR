/* global window, document, getComputedStyle */
// Browser accessibility check for /design (NFR-UX-01, NFR-UX-02): axe-core with colour contrast, 44px touch
// targets, no horizontal scroll at phone width, and reduced-motion, in English and Gujarati.
// Uses playwright-core with a system Chrome/Chromium (no browser download). Not part of `npm run check`;
// run it with `npm run a11y` (CI job "a11y"). Set CHROME_PATH to override the browser location.
// The signed-in pages are covered by `npm run e2e` (same scan, with the API running).
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
  await browser.close();
} finally {
  killTree(server);
}

if (failures.length > 0) {
  console.error(`\na11y FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('a11y passed');
