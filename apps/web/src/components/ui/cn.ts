/** Join class names, skipping falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Visually hidden but available to screen readers. */
export const SR_ONLY = 'sr-only';

/** Minimum touch target: 44px (design token --target-min, WCAG 2.5.5 / 2.5.8). */
export const TARGET = 'min-h-11 min-w-11';
