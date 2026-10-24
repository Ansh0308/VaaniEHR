// ABDM sandbox smoke test (Phase 9B, ADR-D42). NOT RUN in the build: it needs sandbox credentials the owner does not have yet
// (docs/OWNER_ACTIONS.md). It checks the UNVERIFIED assumptions in docs/ABDM.md against the real sandbox, using ONE sandbox TEST
// identity the owner got from ABDM. It never prints the identity, the OTP, a token or a response body: only pass or fail words.
//
//   ABDM_CLIENT_ID=... ABDM_CLIENT_SECRET=... ABDM_SANDBOX_TEST_IDENTITY=<test abha number or address> \
//     node scripts/abdm-smoke.mjs            (add ABDM_SMOKE_OTP=<otp> only if the sandbox test account has a fixed OTP)
//
// Needs the api-node sources compiled or run through tsx: `npx tsx scripts/abdm-smoke.mjs` from the repository root.
import { AbdmClient } from '../apps/api-node/src/abdm/client.ts';
import { checkIdentity } from '../apps/api-node/src/abdm/identityGuard.ts';
import { AbhaError } from '../apps/api-node/src/abdm/errors.ts';
import { SandboxAbha } from '../apps/api-node/src/abdm/sandboxProvider.ts';

const { ABDM_CLIENT_ID, ABDM_CLIENT_SECRET, ABDM_SANDBOX_TEST_IDENTITY, ABDM_SMOKE_OTP } =
  process.env;
const say = (ok, what) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

if (!ABDM_CLIENT_ID || !ABDM_CLIENT_SECRET || !ABDM_SANDBOX_TEST_IDENTITY) {
  console.log(
    'Set ABDM_CLIENT_ID, ABDM_CLIENT_SECRET and ABDM_SANDBOX_TEST_IDENTITY (a sandbox TEST identity). Nothing was sent.',
  );
  process.exit(2);
}
const verdict = checkIdentity(ABDM_SANDBOX_TEST_IDENTITY, 'sandbox', [ABDM_SANDBOX_TEST_IDENTITY]);
if (
  verdict.reason === 'aadhaar_like' ||
  verdict.reason === 'production_address' ||
  verdict.reason === 'malformed'
) {
  console.log(
    `Refused: the identity does not look like a sandbox test identity (${verdict.reason}). Nothing was sent.`,
  );
  process.exit(2);
}

const client = new AbdmClient({
  clientId: ABDM_CLIENT_ID,
  clientSecret: ABDM_CLIENT_SECRET,
  ...(process.env.ABDM_SESSION_URL ? { sessionUrl: process.env.ABDM_SESSION_URL } : {}),
  ...(process.env.ABDM_CERT_URL ? { certUrl: process.env.ABDM_CERT_URL } : {}),
  ...(process.env.ABDM_ABHA_URL ? { abhaUrl: process.env.ABDM_ABHA_URL } : {}),
});
let failed = false;
const step = async (what, fn) => {
  try {
    const out = await fn();
    say(true, what);
    return out;
  } catch (e) {
    failed = true;
    say(false, `${what} (${e instanceof AbhaError ? e.failure : 'unexpected'})`);
    return null;
  }
};

await step('access token', () => client.accessToken());
await step('public key readable', () => client.publicKey());
const provider = new SandboxAbha(client);
const started = await step('OTP requested (an OTP is sent to the test account)', () =>
  provider.startOtp({ kind: verdict.kind, value: verdict.value }),
);
if (started && ABDM_SMOKE_OTP) {
  await step('OTP verified and a profile with an ABHA address returned', async () => {
    const r = await provider.verifyOtp({ txn: started.txn, otp: ABDM_SMOKE_OTP });
    if (!r.abhaAddress) throw new AbhaError('rejected', 'no address');
  });
} else if (started) {
  console.log(
    'Request done. The OTP belongs to a transaction that lives in this process, so run the whole check in one go: put the OTP in ABDM_SMOKE_OTP only if your sandbox test account shows a fixed OTP.',
  );
}
process.exit(failed ? 1 : 0);
