// Allergies are safety information, so they get the "acknowledge" (amber) treatment with an icon and a visible heading,
// at the top of the patient card. Entries are free text (ClinicOS has no allergy field; VaaniEHR owns the list).
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { STATE_STYLES } from '../../design/states';
import { Chip } from '../ui/Badge';
import { cn } from '../ui/cn';

export function AllergyList({
  allergies,
  onRemove,
}: {
  allergies: readonly string[];
  /** When given, each chip has a remove button (staff and admin edit; doctors only read). */
  onRemove?: (index: number) => void;
}) {
  const { t } = useTranslation('patients');
  const style = STATE_STYLES.acknowledge;
  return (
    <section
      aria-labelledby="allergies-heading"
      className={cn(
        'rounded-md p-3',
        allergies.length > 0 ? style.panel : 'border border-control bg-card',
      )}
    >
      <h3 id="allergies-heading" className="flex items-center gap-2 text-base font-semibold">
        <TriangleAlert
          aria-hidden="true"
          className={cn('size-5 shrink-0', allergies.length > 0 ? style.icon : 'text-ink')}
        />
        {t('patients:allergies.heading')}
      </h3>
      {allergies.length === 0 ? (
        <p className="mt-1 text-sm text-body">{t('patients:allergies.none')}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {allergies.map((allergy, index) => (
            <li key={`${allergy}-${index}`}>
              <Chip
                {...(onRemove
                  ? {
                      onRemove: () => onRemove(index),
                      removeLabel: t('patients:allergies.remove', { name: allergy }),
                    }
                  : {})}
              >
                {allergy}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
