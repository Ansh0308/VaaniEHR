// Shared helpers for repo scripts. Cross-platform (Windows/Linux/macOS); no shell scripts (ADR-D9).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Run a command with fixed arguments. Returns { status, stdout, stderr } (status 1 if it could not start). */
export function run(command, args, options = {}) {
  const { shell = false, cwd = ROOT, env = process.env, quiet = false } = options;
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) {
    console.error(`Could not start "${command}": ${result.error.message}`);
    return { status: 1, stdout: '', stderr: String(result.error.message) };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** npm is a .cmd file on Windows and needs a shell; arguments passed here are always fixed literals. */
export function npm(args, options = {}) {
  return run('npm', args, { ...options, shell: true });
}
