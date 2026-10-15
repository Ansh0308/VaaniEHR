// MedicineRow (PRD PG-08, F6): one prescription line with its safety status. Generic name first; brand optional.
// Demo medicines are FAKE ("Drug-A"); real rows come from a cited source (Hard Rule 3).
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SafetyState } from '../../design/states';
import { StateBadge } from '../ui/Badge';
import { IconButton } from '../ui/Button';

export interface MedicineRowProps {
  generic: string;
  brand?: string;
  strength: string;
  form: string;
  dose: string;
  frequency: string;
  duration: string;
  source: string;
  safety: SafetyState;
  onEdit?: () => void;
  onRemove?: () => void;
}

export function MedicineRow({
  generic,
  brand,
  strength,
  form,
  dose,
  frequency,
  duration,
  source,
  safety,
  onEdit,
  onRemove,
}: MedicineRowProps) {
  const { t } = useTranslation('clinical');
  const fields: Array<[string, string]> = [
    [t('clinical:medicine.dose'), dose],
    [t('clinical:medicine.frequency'), frequency],
    [t('clinical:medicine.duration'), duration],
  ];
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-control bg-card p-4">
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold text-ink">
          {generic}{' '}
          <span className="font-normal text-body">
            {strength}, {form}
          </span>
        </p>
        {brand ? (
          <p className="text-sm text-body">{t('clinical:medicine.brand', { brand })}</p>
        ) : null}
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {fields.map(([term, description]) => (
            <div key={term} className="flex gap-1.5">
              <dt className="font-semibold text-body">{term}:</dt>
              <dd className="text-ink">{description}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 text-xs text-body">{t('clinical:medicine.source', { source })}</p>
      </div>
      <div className="flex items-center gap-1">
        <StateBadge state={safety} />
        {onEdit ? (
          <IconButton
            icon={Pencil}
            label={t('clinical:medicine.edit', { name: generic })}
            onClick={onEdit}
          />
        ) : null}
        {onRemove ? (
          <IconButton
            icon={Trash2}
            label={t('clinical:medicine.remove', { name: generic })}
            onClick={onRemove}
          />
        ) : null}
      </div>
    </li>
  );
}
