// i18next setup (NFR-UX-02): English and Gujarati, four namespaces, no hard-coded UI strings.
// Gujarati strings are PLACEHOLDERS and need review by a Gujarati speaker (see docs/DESIGN.md).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enAudit from './locales/en/audit.json';
import enAuth from './locales/en/auth.json';
import enClinical from './locales/en/clinical.json';
import enConsent from './locales/en/consent.json';
import enDashboard from './locales/en/dashboard.json';
import enPatients from './locales/en/patients.json';
import enSettings from './locales/en/settings.json';
import enCommon from './locales/en/common.json';
import enDesign from './locales/en/design.json';
import enShell from './locales/en/shell.json';
import guAudit from './locales/gu/audit.json';
import guAuth from './locales/gu/auth.json';
import guClinical from './locales/gu/clinical.json';
import guConsent from './locales/gu/consent.json';
import guDashboard from './locales/gu/dashboard.json';
import guPatients from './locales/gu/patients.json';
import guSettings from './locales/gu/settings.json';
import guCommon from './locales/gu/common.json';
import guDesign from './locales/gu/design.json';
import guShell from './locales/gu/shell.json';

export const LANGUAGES = ['en', 'gu'] as const;
export type Language = (typeof LANGUAGES)[number];
export const NAMESPACES = [
  'common',
  'shell',
  'design',
  'clinical',
  'auth',
  'dashboard',
  'patients',
  'consent',
  'audit',
  'settings',
] as const;

export const resources = {
  en: {
    common: enCommon,
    shell: enShell,
    design: enDesign,
    clinical: enClinical,
    auth: enAuth,
    dashboard: enDashboard,
    patients: enPatients,
    consent: enConsent,
    audit: enAudit,
    settings: enSettings,
  },
  gu: {
    common: guCommon,
    shell: guShell,
    design: guDesign,
    clinical: guClinical,
    auth: guAuth,
    dashboard: guDashboard,
    patients: guPatients,
    consent: guConsent,
    audit: guAudit,
    settings: guSettings,
  },
} as const;

const STORAGE_KEY = 'vaaniehr.language';

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Remembered choice (a per-viewer convenience only; wrapped because storage can be blocked). */
function storedLanguage(): Language {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(value)) return value;
  } catch {
    /* storage unavailable: fall back to English */
  }
  return 'en';
}

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* ignore */
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage(),
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  ns: [...NAMESPACES],
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  initAsync: false,
  returnNull: false,
});

// The lang attribute drives fonts, line height and the Gujarati script safeguards in index.css.
function syncDocumentLang(language: string): void {
  document.documentElement.lang = language;
}
i18n.on('languageChanged', syncDocumentLang);
syncDocumentLang(i18n.language);

export default i18n;
