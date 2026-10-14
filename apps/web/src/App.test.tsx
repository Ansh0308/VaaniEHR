// Hard Rule 1 / NFR-PRIV-02: the simulated-data banner is always visible.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App, { BANNER_TEXT } from './App';
import { config } from './config';

describe('App placeholder', () => {
  it('always shows the research-prototype / simulated-data banner', () => {
    render(<App />);
    const banner = screen.getByRole('status', { name: 'Simulated data notice' });
    expect(banner.textContent).toContain(BANNER_TEXT);
  });

  it('defaults the simulated-data flag to true', () => {
    expect(config.simulatedDataOnly).toBe(true);
  });
});
