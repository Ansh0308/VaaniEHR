/* global window, document, getComputedStyle */
// Browser accessibility check for /design (NFR-UX-01, NFR-UX-02): axe-core with colour contrast, 44px touch
// targets, no horizontal scroll at phone width, and reduced-motion, in English and Gujarati.
// Uses playwright-core with a system Chrome/Chromium (no browser download). Not part of `npm run check`;
// run it with `npm run a11y` (CI job "a11y"). Set CHROME_PATH to override the browser location.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((path) => path && existsSync(path));
}

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
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

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
      // storage key differs from the one assumed above: fall back to the toggle
      await page.click(`button[lang="${lang}"]`);
    }
    await page.evaluate(() => document.fonts.ready);

    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(async (runTags) => {
      const result = await window.axe.run(document, { runOnly: { type: 'tag', values: runTags } });
      return result.violations.map(
        (v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`,
      );
    }, tags);
    for (const v of axe) failures.push(`[${lang}] axe: ${v}`);

    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=switch], [role=combobox]',
        ),
      ]
        .filter((el) => !el.closest('.sr-only, .sr-only-focusable'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
        .map(
          ({ el, r }) =>
            `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        ),
    );
    for (const s of small) failures.push(`[${lang}] target under 44px: ${s}`);

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
      `[${lang}] axe violations: ${axe.length}, small targets: ${small.length}, overflow: ${overflow}px, animated under reduce: ${moving.length}`,
    );
    await context.close();
  }
  await browser.close();
} finally {
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
}

if (failures.length > 0) {
  console.error(`\na11y FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('a11y passed');
