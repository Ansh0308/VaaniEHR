// Request encryption helpers (Phase 9B, ADR-D42, FR-F9-02). ABDM V3 wants sensitive values (an ABHA number or address, an OTP)
// RSA-encrypted with the public key the ABDM certificate endpoint publishes, then base64. The padding is RSA-OAEP with SHA-1
// and MGF1 (Java name RSA/ECB/OAEPWithSHA-1AndMGF1Padding) as stated in ABDM's integration guidance. NOTE: the official
// sandbox documentation host answered 503 during this run, so this was NOT checked against the official page (docs/ABDM.md);
// the first sandbox run must confirm it. The key is a parameter, so tests use a throw-away key pair and a fake value.
import { constants, createPublicKey, publicEncrypt, type KeyObject } from 'node:crypto';

/** The certificate endpoint answers a public key as a PEM block or as bare base64 (DER SubjectPublicKeyInfo). */
export function parsePublicKey(published: string): KeyObject {
  const t = published.trim();
  if (t.includes('BEGIN')) return createPublicKey(t);
  return createPublicKey({
    key: Buffer.from(t.replace(/\s+/g, ''), 'base64'),
    format: 'der',
    type: 'spki',
  });
}

export function encryptForAbdm(publicKey: KeyObject, plain: string): string {
  return publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
    Buffer.from(plain, 'utf8'),
  ).toString('base64');
}
