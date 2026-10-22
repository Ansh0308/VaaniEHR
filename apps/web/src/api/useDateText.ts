import { useTranslation } from 'react-i18next';
import { formatDateTime } from './format';

/** Date and time in the chosen language, for pages that show signed times. */
export function useDateText(): (iso: string) => string {
  const { i18n } = useTranslation();
  return (iso) => formatDateTime(iso, i18n.language);
}
