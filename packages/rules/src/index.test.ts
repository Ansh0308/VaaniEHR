import { describe, expect, it } from 'vitest';
import { RULES_PACKAGE } from './index.js';

describe('@vaaniehr/rules', () => {
  it('is the pathway engine and holds no clinical content', () => {
    expect(RULES_PACKAGE).toEqual({
      name: '@vaaniehr/rules',
      status: 'pathway-engine',
      clinicalContent: 'none',
    });
  });
});
