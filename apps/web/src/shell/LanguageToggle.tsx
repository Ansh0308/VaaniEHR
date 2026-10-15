import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type Language } from '../i18n';
import { cn } from '../components/ui/cn';

/** English / Gujarati switch. Each button is labelled in its own language (lang attribute set) and uses aria-pressed. */
export function LanguageToggle() {
  const { t, i18n } = useTranslation('common');
  const current = i18n.language as Language;
  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="inline-flex rounded-md border border-control bg-card p-0.5"
    >
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          lang={language}
          aria-pressed={current === language}
          onClick={() => setLanguage(language)}
          className={cn(
            'min-h-11 min-w-11 rounded-sm px-3 text-sm font-semibold',
            current === language ? 'bg-action text-on-action' : 'text-ink hover:bg-sunken',
          )}
        >
          {t(`language.${language}`)}
        </button>
      ))}
    </div>
  );
}
