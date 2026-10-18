// Python helper for apps/asr-py: setup | ruff | pytest | dev | exec <args...>. Python 3.11 required.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, ROOT } from './lib.mjs';

const dir = join(ROOT, 'apps', 'asr-py');
const venvDir = join(dir, '.venv');
const venvPython =
  process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');

function is311(command, args) {
  const r = run(command, [...args, '--version'], { quiet: true });
  return r.status === 0 && /Python 3\.11\./.test(`${r.stdout}${r.stderr}`);
}

function systemPython() {
  const candidates =
    process.platform === 'win32'
      ? [
          ['py', ['-3.11']],
          ['python', []],
        ]
      : [
          ['python3.11', []],
          ['python3', []],
          ['python', []],
        ];
  for (const [cmd, args] of candidates) if (is311(cmd, args)) return [cmd, args];
  return null;
}

/** Venv python if present, else a system Python 3.11 (CI installs requirements globally). */
function pythonForTasks() {
  if (existsSync(venvPython)) return [venvPython, []];
  const sys = systemPython();
  if (!sys) {
    console.error('Python 3.11 not found. Install it, then run: npm run py:setup');
    process.exit(1);
  }
  return sys;
}

const [cmd = ''] = process.argv.slice(2);
const rest = process.argv.slice(3);

if (cmd === 'setup') {
  const sys = systemPython();
  if (!sys) {
    console.error('Python 3.11 not found (Windows: py -3.11). Install it and retry.');
    process.exit(1);
  }
  if (!existsSync(venvPython)) {
    const created = run(sys[0], [...sys[1], '-m', 'venv', venvDir]);
    if (created.status !== 0) process.exit(created.status);
  }
  const req = join(dir, 'requirements-dev.txt');
  const installed = run(
    venvPython,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', req],
    { cwd: dir },
  );
  process.exit(installed.status);
}

const [py, pyArgs] = pythonForTasks();
// The service and its commands (dev, exec) read apps/asr-py/.env; lint and tests never do, so they cannot see any key.
if (cmd === 'dev' || cmd === 'exec') {
  const envFile = join(dir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides values already in the environment
}
let status;
if (cmd === 'ruff') {
  status = run(py, [...pyArgs, '-m', 'ruff', 'check', '.'], { cwd: dir }).status;
  if (status === 0) {
    status = run(py, [...pyArgs, '-m', 'ruff', 'format', '--check', '.'], { cwd: dir }).status;
  }
} else if (cmd === 'pytest') {
  status = run(py, [...pyArgs, '-m', 'pytest', ...rest], { cwd: dir }).status;
} else if (cmd === 'dev') {
  const port = process.env.ASR_PY_PORT ?? '8000';
  status = run(py, [...pyArgs, '-m', 'uvicorn', 'app.main:app', '--reload', '--port', port], {
    cwd: dir,
  }).status;
} else if (cmd === 'exec') {
  status = run(py, [...pyArgs, ...rest], { cwd: dir }).status;
} else {
  console.error('Usage: node scripts/py.mjs <setup|ruff|pytest|dev|exec ...>');
  status = 2;
}
process.exit(status);
