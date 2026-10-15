// Turns an API failure into a message the person can act on. The text is ours (i18n), never the server's English text.
import type { TFunction } from 'i18next';
import { ApiError } from './client';

export function errorText(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t('common:errors.generic');
  if (error.status === 0) return t('common:errors.network');
  switch (error.status) {
    case 400:
      return t('common:errors.validation');
    case 401:
      return t('common:errors.session');
    case 403:
      return t('common:errors.forbidden');
    case 404:
      return t('common:errors.notFound');
    case 409:
      return t('common:errors.conflict');
    case 429:
      return t('common:errors.rateLimited');
    default:
      return t('common:errors.generic');
  }
}
