// Starts the HL7 FHIR validator in SERVER mode with the ABDM IG loaded, for the API's "validate this bundle" step (ADR-D40).
//   node scripts/fhir-validator-server.mjs [port]        (default 8090; put FHIR_VALIDATOR_URL=http://localhost:8090 in apps/api-node/.env)
// Loading the IG and the HL7 base packages takes several minutes the first time and about as long on every start; the server
// is ready when it prints a line saying it is listening. Java 11+ is used when present, otherwise the pinned container
// eclipse-temurin:17-jre (port bound to 127.0.0.1 only). Run `node scripts/fhir-fetch.mjs` first.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTEFACTS, FHIR_DIR } from './fhir-fetch.mjs';
import { VALIDATOR_IMAGE } from './fhir-validate.mjs';

const port = process.argv[2] ?? '8090';
const [IG, JAR] = ARTEFACTS.map((a) => a.file);
for (const f of [IG, JAR]) {
  if (!existsSync(f)) {
    console.error(`missing ${f}: run "node scripts/fhir-fetch.mjs" first`);
    process.exit(1);
  }
}
const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
const major = (() => {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${java.stderr}${java.stdout}`);
  return m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : 0;
})();
const tail = (base, validatorPort) => [
  '-jar',
  `${base}/validator/validator_cli-7.0.3.jar`,
  '-server',
  String(validatorPort),
  '-version',
  '4.0.1',
  '-ig',
  `${base}/ig/ndhm.in-6.5.0.tgz`,
];
let child;
if (major >= 11) {
  child = spawn('java', [`-Duser.home=${join(FHIR_DIR, 'home')}`, ...tail(FHIR_DIR, port)], {
    stdio: 'inherit',
  });
} else {
  // The validator listens on 127.0.0.1 INSIDE the container, which Docker cannot publish. So it runs on port+1 and a tiny
  // Perl forwarder (scripts/fhir-forward.pl) in the same container listens on 0.0.0.0:<port> and passes connections on.
  const home = join(FHIR_DIR, 'home');
  mkdirSync(home, { recursive: true });
  const inner = Number(port) + 1;
  const command = [
    'perl',
    '/scripts/fhir-forward.pl',
    port,
    String(inner),
    '&',
    'exec',
    'java',
    ...tail('/fhir', inner),
  ]
    .map((x) => (x === '&' ? x : `'${x}'`))
    .join(' ');
  child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '-p',
      `127.0.0.1:${port}:${port}`,
      '-v',
      `${FHIR_DIR}:/fhir`,
      '-v',
      `${home}:/root`,
      '-v',
      `${join(FHIR_DIR, '..', '..', 'scripts')}:/scripts:ro`,
      VALIDATOR_IMAGE,
      'sh',
      '-c',
      command,
    ],
    { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
}
child.on('exit', (code) => process.exit(code ?? 1));
