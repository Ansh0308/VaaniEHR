// Gate for the future consultation page (Phase 8) and recording controls (Phase 4): when audio AND AI-processing
// consent are not on record it shows why and links back to the consent page instead of the protected content.
// The API enforces the same rule on every recording request (requireConsent); this is the explanation people see.
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Banner } from '../ui/Banner';

export function ConsentGate({
  sessionId,
  recordingAllowed,
  children,
}: {
  sessionId: string;
  recordingAllowed: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('consent');
  if (recordingAllowed) return <>{children}</>;
  return (
    <Banner
      kind="blocked"
      live
      title={t('consent:gate.title')}
      actions={
        <Link
          to={`/consult/${sessionId}/consent`}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-transparent bg-action px-4 py-2 text-base font-semibold text-on-action hover:bg-action-hover"
        >
          <ShieldAlert aria-hidden="true" className="size-5" />
          {t('consent:gate.link')}
        </Link>
      }
    >
      {t('consent:gate.body')}
    </Banner>
  );
}
