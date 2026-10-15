// Hard Rule 1 / NFR-PRIV-02 / ADR-D16: the API refuses to start if any directory row is not marked simulated.
// This runs in EVERY mode (not only production): this prototype never handles real patient data.
import type { ClinicOSAdapter } from '../clinicos/ClinicOSAdapter.js';

export class RealDataError extends Error {
  constructor(count: number) {
    super(
      `Refusing to start: ${count} directory row(s) are marked is_simulated=false. ` +
        'This research prototype runs on acted/simulated data only (ADR-D16).',
    );
    this.name = 'RealDataError';
  }
}

export async function assertAllSimulated(directory: ClinicOSAdapter): Promise<void> {
  const count = await directory.countNonSimulated();
  if (count > 0) throw new RealDataError(count);
}
