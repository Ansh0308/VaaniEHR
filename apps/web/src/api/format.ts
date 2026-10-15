// Date and time display, in the language the person chose. The API always sends ISO-8601 UTC; times are shown in the
// viewer's local time zone.
const locale = (language: string): string => (language === 'gu' ? 'gu-IN' : 'en-IN');

export function formatDateTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** 'YYYY-MM-DD' (a date of birth) shown as a plain date, with no time-zone shift. */
export function formatDate(dateOnly: string, language: string): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) return dateOnly;
  return new Intl.DateTimeFormat(locale(language), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Whole years between a 'YYYY-MM-DD' date of birth and today, or null when it cannot be worked out. */
export function ageInYears(dateOnly: string | null, today: Date = new Date()): number | null {
  if (!dateOnly) return null;
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) return null;
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d))
    age -= 1;
  return age >= 0 ? age : null;
}
