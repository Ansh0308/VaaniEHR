/* global window, document, getComputedStyle */
// Helpers shared by the browser scripts (`npm run a11y`, `npm run e2e`): find a system Chrome (no browser download),
// and scan a loaded page with axe-core (colour contrast included) plus the 44px touch-target check.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export function findChrome() {
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

/** Kills a spawned process and its children (npm starts grandchildren; on Windows that needs taskkill /T). */
export function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

/**
 * Scans the current page: axe violations (WCAG 2.2 AA + best practice, colour contrast ON) and interactive elements
 * smaller than 44x44 CSS px. Returns a list of problem strings, empty when the page is clean.
 */
export async function scanPage(page, label) {
  const problems = [];
  await page.evaluate(() => document.fonts.ready);
  // entrance animations fade content in; measure contrast only once they are done (endless decorative loops are ignored)
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (a) =>
            a.effect?.getComputedTiming().iterations === Infinity || a.playState === 'finished',
        ),
    undefined,
    { timeout: 10000 },
  );
  await page.waitForTimeout(900); // JS-driven entrances (motion) are not in getAnimations()
  // table rows fade in one after another (motion): measure only once the last one is fully visible
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('tbody tr')].every(
          (r) => parseFloat(getComputedStyle(r).opacity) >= 0.999,
        ),
      undefined,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) {
    await page.addScriptTag({ content: axeSource });
  }
  const violations = await page.evaluate(async (tags) => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return result.violations.map((v) => {
      const data = v.nodes[0]?.any?.[0]?.data;
      const detail =
        v.id === 'color-contrast' && data
          ? ` [${data.fgColor} on ${data.bgColor}, ratio ${data.contrastRatio}, needs ${data.expectedContrastRatio}]`
          : '';
      return `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}${detail}`;
    });
  }, AXE_TAGS);
  for (const v of violations) problems.push(`[${label}] axe: ${v}`);

  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=switch], [role=combobox]',
      ),
    ]
      .filter((el) => !el.closest('.sr-only, .sr-only-focusable'))
      .map((el) => {
        // a radio or checkbox is operated through its label, so the label is the touch target
        const wrapper = ['radio', 'checkbox'].includes(el.type) ? el.closest('label') : null;
        return { el, r: (wrapper ?? el).getBoundingClientRect() };
      })
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
      .map(
        ({ el, r }) =>
          `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
      ),
  );
  for (const s of small) problems.push(`[${label}] target under 44px: ${s}`);
  return problems;
}
