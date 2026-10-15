// Design-rule guards: no hard-coded UI strings, no uppercase / tracking / italic classes (Gujarati safety).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory())
      return name === 'locales' || name === 'test-utils' ? [] : tsxFiles(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

const FILES = tsxFiles(SRC);
const A11Y_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-description']);
const hasLetters = (s: string) => /\p{L}/u.test(s);

describe('no hard-coded UI strings', () => {
  it('JSX text and accessible attributes come from i18n', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const report = (node: ts.Node, text: string) => {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        offenders.push(`${file.replace(SRC, 'src')}:${line + 1} "${text.trim().slice(0, 40)}"`);
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && hasLetters(node.text)) report(node, node.text);
        if (ts.isJsxAttribute(node) && A11Y_ATTRS.has(node.name.getText())) {
          const init = node.initializer;
          if (init && ts.isStringLiteral(init) && hasLetters(init.text)) report(node, init.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });
});

describe('Gujarati-safe styling', () => {
  it('no uppercase, tracking or italic utility classes', () => {
    const banned =
      /(?<![\w-])(uppercase|lowercase|capitalize|italic|tracking-[\w[\].-]+)(?![\w-])/g;
    const offenders: string[] = [];
    for (const file of FILES) {
      // Inline style= lines are the deliberate forced-style specimen on /design, not utility classes.
      const text = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !line.includes('style={{'))
        .join('\n');
      for (const m of text.matchAll(banned)) offenders.push(`${file.replace(SRC, 'src')}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
