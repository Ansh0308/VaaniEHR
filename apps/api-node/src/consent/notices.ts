// Versioned consent notices (FR-F1-02). One folder per version under ./notices/<version>/, one file per language.
// Published versions are immutable: to change wording, add a new version folder. Every notice is a PLACEHOLDER until
// the owner/institution supplies the legal text, and the Gujarati files stay needsReview=true until a Gujarati speaker
// has reviewed them (docs/OWNER_ACTIONS.md).
import en01 from './notices/v0.1/en.json' with { type: 'json' };
import gu01 from './notices/v0.1/gu.json' with { type: 'json' };

export const CONSENT_SCOPES = ['audio', 'ai_processing', 'whatsapp'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];
export const NOTICE_LANGUAGES = ['en', 'gu'] as const;
export type NoticeLanguage = (typeof NOTICE_LANGUAGES)[number];

export interface ConsentNotice {
  version: string;
  language: NoticeLanguage;
  status: 'PLACEHOLDER' | 'APPROVED';
  needsReview: boolean;
  title: string;
  body: string;
  scopes: Record<ConsentScope, { label: string; description: string }>;
}

export interface NoticeStore {
  versions(): string[];
  latestVersion(): string;
  get(version: string, language: NoticeLanguage): ConsentNotice | null;
}

export function createNoticeStore(
  notices: readonly ConsentNotice[] = [en01, gu01] as ConsentNotice[],
): NoticeStore {
  const byKey = new Map(notices.map((n) => [`${n.version}/${n.language}`, n]));
  const versions = [...new Set(notices.map((n) => n.version))].sort(compareVersions);
  return {
    versions: () => [...versions],
    latestVersion: () => versions[versions.length - 1] as string,
    get: (version, language) => byKey.get(`${version}/${language}`) ?? null,
  };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
