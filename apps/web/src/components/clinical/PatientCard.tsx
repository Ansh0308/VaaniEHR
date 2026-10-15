// Patient summary card. Allergy chips come first and are prominent (PRD PG-03).
import { UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ageInYears, formatDate } from '../../api/format';
import type { Patient } from '../../api/types';
import { AllergyList } from './AllergyList';

export function PatientCard({
  patient,
  onRemoveAllergy,
  children,
}: {
  patient: Patient;
  onRemoveAllergy?: (index: number) => void;
  /** Extra controls under the details (add allergy, start session, ...). */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation('patients');
  const age = ageInYears(patient.dob);
  return (
    <article
      aria-labelledby={`patient-${patient.id}`}
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4 shadow-card"
    >
      <AllergyList
        allergies={patient.allergies}
        {...(onRemoveAllergy ? { onRemove: onRemoveAllergy } : {})}
      />
      <div>
        <h2
          id={`patient-${patient.id}`}
          className="flex items-center gap-2 text-xl font-semibold text-ink"
        >
          <UserRound aria-hidden="true" className="size-6 shrink-0" />
          {patient.name ?? t('patients:card.noName')}
        </h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-body">{t('patients:card.phone')}</dt>
            <dd className="font-semibold text-ink">{patient.phone}</dd>
          </div>
          <div>
            <dt className="text-body">{t('patients:card.dob')}</dt>
            <dd className="font-semibold text-ink">
              {patient.dob
                ? `${formatDate(patient.dob, i18n.language)}${age !== null ? ` (${t('patients:card.age', { count: age })})` : ''}`
                : t('patients:card.unknown')}
            </dd>
          </div>
          <div>
            <dt className="text-body">{t('patients:card.gender')}</dt>
            <dd className="font-semibold text-ink">
              {patient.gender ?? t('patients:card.unknown')}
            </dd>
          </div>
          <div>
            <dt className="text-body">{t('patients:card.messages')}</dt>
            <dd className="font-semibold text-ink">
              {patient.optInMsg ? t('patients:card.optIn') : t('patients:card.optOut')}
            </dd>
          </div>
        </dl>
      </div>
      {children}
    </article>
  );
}
