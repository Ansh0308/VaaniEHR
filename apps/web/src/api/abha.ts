// Shapes of the ABHA verification responses (see apps/api-node/openapi.json). MOCK or SANDBOX only; fake data in tests.
export type AbhaMode = 'mock' | 'sandbox';

export interface AbhaMockIdentity {
  number: string;
  address: string;
  outcome: string;
}

export interface AbhaStatus {
  patientId: string;
  verified: boolean;
  abhaAddress: string | null;
  verifiedAt: string | null;
  /** the mode that produced the stored verification */
  verifiedMode: AbhaMode | null;
  /** the mode the server runs in now */
  mode: AbhaMode;
  notice: string;
  mockOtp: string | null;
  mockIdentities: AbhaMockIdentity[] | null;
}

export interface AbhaStarted {
  txnId: string;
  mode: AbhaMode;
  notice: string;
  expiresInSeconds: number;
}
