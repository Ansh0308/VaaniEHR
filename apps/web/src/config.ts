// Public, build-time web configuration (Vite exposes only VITE_* variables; never put secrets here).
export const config = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000',
  /** The banner is always rendered; the flag only exists so a misconfiguration is visible. Default: true. */
  simulatedDataOnly: (import.meta.env.VITE_SIMULATED_DATA_ONLY as string | undefined) !== 'false',
} as const;
