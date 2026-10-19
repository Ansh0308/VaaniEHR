// Pathway CLI (Phase 6A).  node --import tsx packages/rules/src/cli.ts <command> ...
//   validate <dir> [--allow-test]   exit 1 on any problem: bad structure, unknown references, missing gu/hi/en text,
//                                    an ACTIVE pathway without source.reviewed_by, a changed locked version
//   lock <dir>                      record the hash of every active pathway (never changes an existing entry)
//   cases <pathwayDir> <casesDir>   run the hand-written regression cases against the TEST and active pathways
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCases, type CaseFile } from './cases.js';
import { DEFAULT_ENGINE_CONFIG } from './config.js';
import { loadPathwayDir, lockActive } from './loader.js';

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));
const out = (line: string) => process.stdout.write(`${line}\n`);

function main(): number {
  if (command === 'validate' && args[0]) {
    const loaded = loadPathwayDir(args[0], {
      allowTest: flags.has('--allow-test'),
      requireLock: true,
    });
    for (const p of loaded.problems) out(`PROBLEM ${p}`);
    out(`${loaded.pathways.length} pathway(s) loaded, ${loaded.problems.length} problem(s)`);
    return loaded.problems.length === 0 ? 0 : 1;
  }
  if (command === 'lock' && args[0]) {
    const result = lockActive(args[0]);
    for (const p of result.problems) out(`PROBLEM ${p}`);
    out(`locked: ${result.added.length === 0 ? 'nothing new' : result.added.join(', ')}`);
    return result.problems.length === 0 ? 0 : 1;
  }
  if (command === 'cases' && args[0] && args[1]) {
    const loaded = loadPathwayDir(args[0], { allowTest: true });
    if (loaded.problems.length > 0) {
      for (const p of loaded.problems) out(`PROBLEM ${p}`);
      return 1;
    }
    let failed = 0;
    let total = 0;
    if (!existsSync(args[1])) return 1;
    for (const name of readdirSync(args[1])
      .filter((n) => n.endsWith('.cases.json'))
      .sort()) {
      const file = JSON.parse(readFileSync(join(args[1], name), 'utf8')) as CaseFile;
      const failures = runCases(loaded.pathways, file, DEFAULT_ENGINE_CONFIG);
      total += file.cases.length;
      failed += failures.length;
      for (const f of failures) out(`FAIL ${name}: ${f}`);
    }
    out(`${total} case(s), ${failed} failure(s)`);
    return failed === 0 ? 0 : 1;
  }
  out('usage: cli.ts validate <dir> [--allow-test] | lock <dir> | cases <pathwayDir> <casesDir>');
  return 2;
}

process.exitCode = main();
