// Shapes of the erasure-request responses (see apps/api-node/openapi.json). Fake data in tests.
export type ErasureStatus = 'received' | 'in_review' | 'completed' | 'refused';
export type ErasureChannel = 'in_person' | 'phone' | 'written';

export interface ErasureRequest {
  id: string;
  patientId: string;
  patientName: string | null;
  status: ErasureStatus;
  channel: ErasureChannel;
  note: string;
  requestedByRole: string;
  receivedAt: string;
  reviewedAt: string | null;
  decidedAt: string | null;
  refusalReason: string | null;
  result: Record<string, number> | null;
}

export type ErasureImpact = Record<string, number>;
