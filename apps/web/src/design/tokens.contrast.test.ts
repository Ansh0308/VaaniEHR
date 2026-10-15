// @vitest-environment node
// Contrast gate (NFR-UX-01, WCAG 2.1 AA). Reads the REAL tokens in src/design/tokens.css, resolves var() chains
// and checks every text/background pair. Change a colour and this test (part of `npm run check` and CI) decides.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Parse the first :root block into name -> raw value. */
function rootTokens(source: string): Map<string, string> {
  const start = source.indexOf(':root');
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const body = source.slice(open + 1, close);
  const map = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1] as string, (m[2] as string).trim());
  }
  return map;
}

const tokens = rootTokens(css);

function resolve(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`circular token reference: ${name}`);
  seen.add(name);
  const raw = tokens.get(name);
  if (raw === undefined) throw new Error(`unknown token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  return ref ? resolve(ref[1] as string, seen) : raw;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`expected a 6-digit hex colour, got "${hex}"`);
  const value = m[1] as string;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = { fg: string; bg: string; min: number; what: string };
const TEXT = 4.5;
const NON_TEXT = 3;

const surfaces = ['--surface-page', '--surface-card', '--surface-sunken', '--surface-selected'];
const states = ['clear', 'acknowledge', 'blocked', 'unconfirmed', 'ai'];

const PAIRS: Pair[] = [
  // body text on every surface
  ...surfaces.flatMap((bg) =>
    ['--text-primary', '--text-secondary', '--text-body', '--text-muted'].map((fg) => ({
      fg,
      bg,
      min: TEXT,
      what: `${fg} on ${bg}`,
    })),
  ),
  // primary action
  { fg: '--text-on-action', bg: '--action-primary', min: TEXT, what: 'button text on primary' },
  {
    fg: '--text-on-action',
    bg: '--action-primary-hover',
    min: TEXT,
    what: 'button text on primary hover',
  },
  // focus indicator and control outlines (non-text 3:1)
  { fg: '--focus-ring', bg: '--surface-page', min: NON_TEXT, what: 'focus ring on page' },
  { fg: '--focus-ring', bg: '--surface-card', min: NON_TEXT, what: 'focus ring on card' },
  { fg: '--focus-ring', bg: '--surface-sunken', min: NON_TEXT, what: 'focus ring on sunken' },
  { fg: '--border-control', bg: '--surface-card', min: NON_TEXT, what: 'control outline on card' },
  { fg: '--border-control', bg: '--surface-page', min: NON_TEXT, what: 'control outline on page' },
  // safety states: text on tint, icon/accent on tint, accent outline against the surrounding surfaces
  ...states.flatMap((s) => [
    { fg: `--state-${s}-fg`, bg: `--state-${s}-bg`, min: TEXT, what: `${s} text on tint` },
    { fg: `--state-${s}-accent`, bg: `--state-${s}-bg`, min: NON_TEXT, what: `${s} icon on tint` },
    {
      fg: `--state-${s}-accent`,
      bg: '--surface-card',
      min: NON_TEXT,
      what: `${s} outline on card`,
    },
    {
      fg: `--state-${s}-accent`,
      bg: '--surface-page',
      min: NON_TEXT,
      what: `${s} outline on page`,
    },
  ]),
];

describe('design tokens: WCAG 2.1 AA contrast (reads src/design/tokens.css)', () => {
  it('parses the palette and semantic layers', () => {
    expect(tokens.size).toBeGreaterThan(40);
    expect(resolve('--text-primary')).toBe('#1c0910'); // ClinicOS text-primary, reused
  });

  it.each(PAIRS)('$what meets $min:1', ({ fg, bg, min }) => {
    const ratio = contrast(resolve(fg), resolve(bg));
    expect(
      ratio,
      `${fg} ${resolve(fg)} on ${bg} ${resolve(bg)} = ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(min);
  });

  it('every text, foreground and state token is covered by at least one pair (new colours must be added here)', () => {
    const covered = new Set(PAIRS.flatMap((p) => [p.fg, p.bg]));
    const mustCover = [...tokens.keys()].filter((name) =>
      /^--(text-|state-.*-(fg|bg|accent)$|action-|focus-ring$|border-control$)/.test(name),
    );
    const missing = mustCover.filter((name) => !covered.has(name));
    expect(missing, `tokens without a contrast pair: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the primary action neutral: not crimson and not one of the five state hues (ADR-D7)', () => {
    const primary = resolve('--action-primary').toLowerCase();
    const forbidden = [
      '--palette-green-700',
      '--palette-amber-700',
      '--palette-red-700',
      '--palette-blue-700',
    ]
      .map((n) => resolve(n).toLowerCase())
      .concat(['#c43055', '#a02040', '#4e0e20']); // ClinicOS crimson 500/600/800
    expect(forbidden).not.toContain(primary);
  });
});
