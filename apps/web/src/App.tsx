import { config } from './config';

export const BANNER_TEXT = 'Research prototype - simulated data only. Not for clinical use.';

/** Phase 1.1 placeholder. The real design system, i18n (en/gu) and pages arrive in Phase 1.2+. */
export default function App() {
  return (
    <div className="min-h-screen">
      <div
        role="status"
        aria-label="Simulated data notice"
        className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold"
      >
        {BANNER_TEXT}
        {config.simulatedDataOnly ? null : ' CONFIGURATION ERROR: simulated-data flag is off.'}
      </div>
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-bold">VaaniEHR</h1>
        <p className="mt-2">Foundation placeholder (Phase 1.1). No clinical content.</p>
      </main>
    </div>
  );
}
