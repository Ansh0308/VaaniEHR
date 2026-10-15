import { describe, expect, it } from 'vitest';
import { ageInYears, formatDate, formatDateTime } from './format';

describe('ageInYears', () => {
  const today = new Date(Date.UTC(2026, 9, 15)); // 15 Oct 2026
  it('counts whole years and handles birthdays not yet reached', () => {
    expect(ageInYears('1990-10-15', today)).toBe(36); // birthday today
    expect(ageInYears('1990-10-16', today)).toBe(35); // tomorrow
    expect(ageInYears('1990-01-01', today)).toBe(36);
    expect(ageInYears('2026-10-15', today)).toBe(0);
  });
  it('is null when unknown, malformed or in the future', () => {
    expect(ageInYears(null, today)).toBeNull();
    expect(ageInYears('not-a-date', today)).toBeNull();
    expect(ageInYears('2999-01-01', today)).toBeNull();
  });
});

describe('date formatting', () => {
  it('formats a date of birth without a time-zone shift', () => {
    expect(formatDate('1990-05-17', 'en')).toContain('17');
    expect(formatDate('1990-05-17', 'en')).toContain('1990');
  });
  it('uses Gujarati digits and names for Gujarati', () => {
    expect(formatDate('1990-05-17', 'gu')).toMatch(/[઀-૿]/);
  });
  it('falls back to the raw text for something that is not a date', () => {
    expect(formatDateTime('nonsense', 'en')).toBe('nonsense');
    expect(formatDate('nonsense', 'en')).toBe('nonsense');
  });
  it('formats a timestamp with a date and a time', () => {
    const text = formatDateTime('2026-10-15T10:30:00.000Z', 'en');
    expect(text).toContain('2026');
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});
