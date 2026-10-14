import { describe, expect, it } from 'vitest';
import { RULES_PACKAGE } from './index.js';

describe('@vaaniehr/rules stub', () => {
  it('is an empty stub with no clinical content', () => {
    expect(RULES_PACKAGE).toEqual({
      name: '@vaaniehr/rules',
      status: 'stub',
      clinicalContent: 'none',
    });
  });
});
