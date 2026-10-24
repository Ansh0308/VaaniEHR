// ABHA status badge for the patient card and the consult workspace (Phase 9B, ADR-D42). It always carries the word MOCK or SANDBOX,
// so a verified badge can never be taken for a real verification. If the status cannot be read the badge is left out.
import { BadgeCheck, CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AbhaMode, AbhaStatus } from '../../api/abha';
import { useRequest } from '../../api/useRequest';
import { useAuth } from '../../auth/AuthContext';
import { cn } from '../ui/cn';

export function ModeBadge({ mode, className }: { mode: AbhaMode; className?: string }) {
  const { t } = useTranslation('patients');
  return (
    <span
      data-abha-mode={mode}
      className={cn(
        'inline-flex items-center rounded-sm border-2 border-ink bg-card px-2.5 py-1 text-xs font-bold text-ink',
        className,
      )}
    >
      {t(`patients:abha.mode.${mode}`)}
    </span>
  );
}

export function AbhaBadge({ patientId }: { patientId: string }) {
  const { t } = useTranslation('patients');
  const { api } = useAuth();
  const status = useRequest(
    () => api.get<AbhaStatus>(`/abha/status/${patientId}`),
    [api, patientId],
  );
  if (status.state.status !== 'ready') return null;
  const s = status.state.data;
  const Icon = s.verified ? BadgeCheck : CircleDashed;
  return (
    <p
      className="inline-flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"
      data-testid="abha-badge"
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      <span>
        {s.verified
          ? t('patients:abha.badge.verified', {
              mode: t(`patients:abha.mode.${s.verifiedMode ?? s.mode}`),
            })
          : t('patients:abha.badge.notVerified')}
      </span>
      <ModeBadge mode={s.verifiedMode ?? s.mode} />
    </p>
  );
}
