// Pathway CLI (Phase 6A, 6B).  node --import tsx packages/rules/src/cli.ts <command> ...
//   validate <dir> [--allow-test]    exit 1 on any problem: bad structure, unknown references, missing gu/hi/en text,
//                                    an ACTIVE pathway without reviewer / per-node source trail, a changed locked version
//   lock <dir>                       record the hash of every active pathway (never changes an existing entry)
//   cases <pathwayDir> <casesDir>    run the hand-written regression cases against the test and active pathways
//   coverage <pathwayDir> <casesDir> [--fail-under N]   which nodes and edges the cases exercise
//   new <dir> <id> [--doc "name"]    scaffold an empty DRAFT pathway (mandatory fields, no content)
//   version <file>                   write the next version of a pathway next to it, as a draft (an active file is never edited)
//   lint <fileOrDir>                 what is still missing before sign-off; exit 1 on errors, warnings never fail
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { runCases, type CaseFile } from './cases.js';
import { DEFAULT_ENGINE_CONFIG } from './config.js';
import { coverageReport } from './coverage.js';
import { lintPathway, nextVersion, scaffoldPathway } from './lint.js';
import { loadPathwayDir, lockActive } from './loader.js';
import {
  SAFETY_LOCK_FILE,
  safetyRuleSetHash,
  validateSafetyLockFile,
  validateSafetyRuleSetCollection,
  type SafetyLockFile,
} from './safety.js';

const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i] as string;
  if (a.startsWith('--')) {
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--') && ['--doc', '--fail-under'].includes(a)) {
      flags.set(a, next);
      i += 1;
    } else flags.set(a, '');
  } else args.push(a);
}
const out = (line: string) => process.stdout.write(`${line}\n`);

function pathwayFiles(target: string): string[] {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target)
    .sort()
    .flatMap((n) => {
      const full = join(target, n);
      if (statSync(full).isDirectory()) return pathwayFiles(full);
      return n.endsWith('.pathway.json') ? [full] : [];
    });
}

function readCases(dir: string): CaseFile[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.cases.json'))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')) as CaseFile);
}

function safetyFiles(target: string): string[] {
  if (!existsSync(target)) throw new Error(`${target}: path does not exist`);
  if (statSync(target).isFile()) {
    if (!target.endsWith('.safety.json'))
      throw new Error(`${target}: expected a .safety.json file or directory`);
    return [target];
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir)
      .sort()
      .flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory()
          ? walk(full)
          : name.endsWith('.safety.json')
            ? [full]
            : [];
      });
  return walk(target);
}

function readSafetyLock(dir: string): { lock?: SafetyLockFile; problems: string[] } {
  const file = join(dir, SAFETY_LOCK_FILE);
  if (!existsSync(file)) return { problems: [] };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    const finding = validateSafetyLockFile(raw, file);
    return finding.errors.length
      ? { problems: finding.errors }
      : { lock: raw as SafetyLockFile, problems: [] };
  } catch {
    return { problems: [`${file}: not valid JSON`] };
  }
}

function lintSafety(target: string): number {
  try {
    const files = safetyFiles(target);
    if (files.length === 0) {
      out(`${target}: no .safety.json files found`);
      return 1;
    }
    const root = statSync(target).isDirectory() ? target : dirname(target);
    const items: { file: string; data: unknown }[] = [];
    const errors: string[] = [];
    for (const file of files)
      try {
        items.push({
          file: relative(root, file).split(sep).join('/'),
          data: JSON.parse(readFileSync(file, 'utf8')),
        });
      } catch {
        errors.push(`${file}: not valid JSON`);
      }
    const lockRead = readSafetyLock(root);
    errors.push(...lockRead.problems);
    const finding = validateSafetyRuleSetCollection(items, lockRead.lock, true);
    errors.push(...finding.errors);
    for (const error of errors) out(`ERROR ${error}`);
    for (const warning of finding.warnings) out(`WARN  ${warning}`);
    out(`${files.length} safety file(s), ${errors.length} error(s)`);
    return errors.length ? 1 : 0;
  } catch (error) {
    out(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function lockSafety(target: string): number {
  try {
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      out(`ERROR ${target}: safety-lock requires an existing directory`);
      return 2;
    }
    const files = safetyFiles(target);
    if (files.length === 0) {
      out(`ERROR ${target}: no .safety.json files found`);
      return 1;
    }
    const items: { file: string; data: unknown }[] = [];
    const errors: string[] = [];
    for (const file of files)
      try {
        items.push({
          file: relative(target, file).split(sep).join('/'),
          data: JSON.parse(readFileSync(file, 'utf8')),
        });
      } catch {
        errors.push(`${file}: not valid JSON`);
      }
    const existing = readSafetyLock(target);
    errors.push(...existing.problems);
    const base = validateSafetyRuleSetCollection(items);
    errors.push(...base.errors);
    const approved = items.filter(
      (item) => (item.data as { status?: unknown }).status === 'clinically_approved',
    );
    if (approved.length === 0)
      errors.push(`${target}: no clinically_approved rule sets may be locked`);
    if (errors.length) {
      for (const error of errors) out(`ERROR ${error}`);
      return 1;
    }
    const lock: SafetyLockFile = existing.lock ?? {
      schema_version: 1,
      source: 'Safety rule-set content hashes (immutability lock); not clinical approval.',
      locks: {},
    };
    const added: string[] = [];
    for (const item of approved) {
      const data = item.data as { id: string; version: number };
      const key = `${data.id}@${data.version}`;
      const entry = { file: item.file, sha256: safetyRuleSetHash(item.data) };
      const prior = lock.locks[key];
      if (prior && (prior.file !== entry.file || prior.sha256 !== entry.sha256))
        errors.push(
          `${key}: existing immutable lock differs; create a new rule-set version instead`,
        );
      else if (!prior) {
        lock.locks[key] = entry;
        added.push(key);
      }
    }
    if (errors.length) {
      for (const error of errors) out(`ERROR ${error}`);
      return 1;
    }
    if (added.length === 0) {
      out('locked: nothing new (existing locks were not overwritten)');
      return 0;
    }
    writeFileSync(join(target, SAFETY_LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    out(`locked: ${added.join(', ')} (hashing does not confer clinical approval)`);
    return 0;
  } catch (error) {
    out(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function main(): number {
  if (command === 'safety-lint' && args[0]) return lintSafety(args[0]);
  if (command === 'safety-lock' && args[0]) return lockSafety(args[0]);
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
  if ((command === 'cases' || command === 'coverage') && args[0] && args[1]) {
    const loaded = loadPathwayDir(args[0], { allowTest: true });
    if (loaded.problems.length > 0) {
      for (const p of loaded.problems) out(`PROBLEM ${p}`);
      return 1;
    }
    if (!existsSync(args[1])) return 1;
    if (command === 'cases') {
      let failed = 0;
      let total = 0;
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
    const report = coverageReport(loaded.pathways, readCases(args[1]), DEFAULT_ENGINE_CONFIG);
    let worst = 100;
    for (const c of report) {
      const pct = Math.round(
        ((c.nodes_hit + c.edges_hit) / Math.max(1, c.nodes_total + c.edges_total)) * 100,
      );
      worst = Math.min(worst, pct);
      out(
        `${c.pathway_id}: nodes ${c.nodes_hit}/${c.nodes_total}, edges ${c.edges_hit}/${c.edges_total} (${pct}%)`,
      );
      for (const n of c.missing_nodes) out(`  not exercised: node ${n}`);
      for (const e of c.missing_edges) out(`  not exercised: edge ${e}`);
    }
    const floor = flags.get('--fail-under');
    return floor !== undefined && floor !== '' && worst < Number(floor) ? 1 : 0;
  }
  if (command === 'new' && args[0] && args[1]) {
    const id = args[1];
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(id)) {
      out('the id must be lower case letters, digits and underscores, starting with a letter');
      return 2;
    }
    const file = join(args[0], `${id}.pathway.json`);
    if (existsSync(file)) {
      out(`${file} already exists; use the version command to make a new version`);
      return 2;
    }
    writeFileSync(
      file,
      `${JSON.stringify(scaffoldPathway(id, flags.get('--doc') || undefined), null, 2)}\n`,
      'utf8',
    );
    out(`wrote ${file} (status draft, no nodes). Run lint to see what is missing.`);
    return 0;
  }
  if (command === 'version' && args[0]) {
    const source = JSON.parse(readFileSync(args[0], 'utf8')) as Record<string, unknown>;
    const next = nextVersion(source);
    const dir = dirname(args[0]);
    const taken = pathwayFiles(dir).some((f) => {
      const p = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      return p.id === next.id && p.version === next.version;
    });
    if (taken) {
      out(`version ${String(next.version)} of ${String(next.id)} already exists`);
      return 2;
    }
    const file = join(dir, `${String(next.id)}.v${String(next.version)}.pathway.json`);
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    out(`wrote ${basename(file)} (draft, sign-off cleared). The old version is not touched.`);
    return 0;
  }
  if (command === 'lint' && args[0]) {
    let errors = 0;
    let warnings = 0;
    const files = pathwayFiles(args[0]);
    for (const file of files) {
      let findings;
      try {
        findings = lintPathway(JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        out(`ERROR ${file}: not valid JSON`);
        errors += 1;
        continue;
      }
      for (const f of findings) {
        out(`${f.level === 'error' ? 'ERROR' : 'WARN '} ${basename(file)}: ${f.message}`);
        if (f.level === 'error') errors += 1;
        else warnings += 1;
      }
    }
    out(`${files.length} file(s), ${errors} error(s), ${warnings} warning(s)`);
    return errors === 0 ? 0 : 1;
  }
  out(
    'usage: cli.ts validate|lock|cases|coverage|new|version|lint|safety-lint|safety-lock ... (see the header of packages/rules/src/cli.ts)',
  );
  return 2;
}

process.exitCode = main();
