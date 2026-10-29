// @vaaniehr/rules - the pathway question engine (F4). Pure functions; the only file that reads the disk is loader.ts.
// NO CLINICAL CONTENT lives here: the only pathways in the repository are obviously fake toy ones (status "test").
// Real pathways are transcribed by the owner from ICMR Standard Treatment Workflows and reviewed by a clinician
// (AGENTS.md Hard Rule 3; docs/OWNER_ACTIONS.md). The safety engine (F6) is a later phase.

export const RULES_PACKAGE = {
  name: '@vaaniehr/rules',
  status: 'pathway-engine',
  clinicalContent: 'none',
} as const;

export * from './cases.js';
export * from './config.js';
export * from './engine.js';
export * from './loader.js';
export * from './slots.js';
export * from './types.js';
export * from './validate.js';
export * from './linking.js';
export * from './safety.js';
