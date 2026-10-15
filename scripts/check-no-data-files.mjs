// Fails if data/audio files are tracked (or about to be added) in git. Owner decision 2026-10-15: no datasets,
// recordings or raw data in this public repository. Paths: any "data/" or "audio/" directory, and *.wav, *.mp3,
// *.m4a, *.webm files anywhere. Mirrors the .gitignore rules; this guard catches force-added files.
import { run, ROOT } from './lib.mjs';

const dirPattern = /(^|\/)(data|audio)\//i;
const extPattern = /\.(wav|mp3|m4a|webm)$/i;

const { status, stdout } = run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  quiet: true,
  cwd: ROOT,
});
if (status !== 0) {
  console.error('git ls-files failed; cannot run the data/audio guard.');
  process.exit(1);
}
const offenders = stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => dirPattern.test(file) || extPattern.test(file));
if (offenders.length > 0) {
  console.error(
    'Data/audio files must not be tracked in git (data/, audio/, *.wav, *.mp3, *.m4a, *.webm):',
  );
  for (const file of offenders) console.error(`  - ${file}`);
  console.error('Keep them outside the repository, or ask the owner before changing this rule.');
  process.exit(1);
}
console.log('OK: no data/, audio/, *.wav, *.mp3, *.m4a or *.webm files tracked');
