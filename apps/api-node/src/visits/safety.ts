// SafetyChecks (PRD F6; Phase 8 Run 1). The safety engine is Phase 7 and does NOT exist yet: this interface is the place
// it will plug in, and today the only implementation reports "not configured". The sign route always asks it; while it is
// not configured the doctor must explicitly acknowledge "Safety checks were not run", and the signed record stores that.
import type { SignedMedicine } from './repository.js';

export interface SafetyInput {
  sessionId: string;
  medicines: SignedMedicine[];
}
export interface SafetyResult {
  /** false = no safety engine exists/ran */
  configured: boolean;
  /** number of blocked (red) alerts that are still unresolved; always 0 while not configured */
  blocked: number;
  message: string;
}
export interface SafetyChecks {
  run(input: SafetyInput): Promise<SafetyResult>;
}

export class NotConfiguredSafetyChecks implements SafetyChecks {
  async run(): Promise<SafetyResult> {
    return {
      configured: false,
      blocked: 0,
      message: 'Safety checks are not configured (the safety engine is not built yet).',
    };
  }
}
