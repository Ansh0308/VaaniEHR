// Fails if the repository contains .sh/.bat/.cmd/.ps1 files outside .github/ (ADR-D9: cross-platform scripts only).
import { run, ROOT } from './lib.mjs';

const forbidden = /\.(sh|bash|bat|cmd|ps1)$/i;
const { status, stdout } = run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  quiet: true,
  cwd: ROOT,
});
if (status !== 0) {
  console.error('git ls-files failed; cannot run the shell-script guard.');
  process.exit(1);
}
const offenders = stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => forbidden.test(file) && !file.startsWith('.github/'));
if (offenders.length > 0) {
  console.error('Shell/batch scripts are not allowed outside .github/ (use Node or Python):');
  for (const file of offenders) console.error(`  - ${file}`);
  process.exit(1);
}
console.log('OK: no .sh/.bash/.bat/.cmd/.ps1 files outside .github/');
