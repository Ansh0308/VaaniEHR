// MedicineCombobox: search the medicine master as you type (generic or brand name, English or Gujarati).
// - starts after 2 characters, waits for a pause in typing, and ignores answers that arrive late;
// - the generic name comes first, the brand name is lighter, strength and dose form stay visible;
// - a medicine that nobody has clinically reviewed says so on its line until reviewed_on is set;
// - a retired medicine is never offered (the API does not return it, and it is filtered here as well).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Medicine } from '../../api/medicines';
import { useAuth } from '../../auth/AuthContext';
import { Combobox, type ComboboxOption } from '../ui/Combobox';

export const MIN_CHARS = 2;
export const DEBOUNCE_MS = 250;
const RESULTS = 10;

/** What the combobox needs to show a medicine; a full Medicine, or a template line's brief, both fit. */
export interface MedicineLike {
  id: string;
  genericName: string;
  strength: string | null;
  doseForm: string | null;
  reviewStatus: 'reviewed' | 'not_reviewed';
  /** Set when the medicine was retired after it was added to a template. */
  retired?: boolean;
  brands?: Medicine['brands'];
}

/** "Drug-A 500 mg · Tablet": the one-line name used wherever a medicine is shown. */
export function medicineText(
  m: Pick<MedicineLike, 'genericName' | 'strength' | 'doseForm'>,
): string {
  return [m.genericName, m.strength, m.doseForm].filter(Boolean).join(' · ');
}

export function medicineOption(
  m: MedicineLike,
  t: (key: string, options?: Record<string, unknown>) => string,
): ComboboxOption {
  const detail = [m.strength, m.doseForm].filter(Boolean).join(' · ');
  const brands = (m.brands ?? []).map((b) => b.brandName);
  return {
    id: m.id,
    label: m.genericName,
    ...(detail ? { secondary: detail } : {}),
    ...(brands.length > 0
      ? { tertiary: t('medicines:combobox.brand', { brand: brands.slice(0, 3).join(', ') }) }
      : {}),
    ...(m.reviewStatus === 'not_reviewed' ? { note: t('medicines:notReviewedLine') } : {}),
    inputText: medicineText(m),
  };
}

export function MedicineCombobox({
  value,
  onChange,
  label,
  inputId,
  error,
}: {
  value: MedicineLike | null;
  onChange: (medicine: MedicineLike | null) => void;
  label?: string;
  inputId?: string;
  error?: string;
}) {
  const { t } = useTranslation('medicines');
  const { api } = useAuth();
  const [found, setFound] = useState<Medicine[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    const mine = ++latest.current;
    if (text.length < MIN_CHARS) {
      setFound([]);
      setBusy(false);
      setFailed(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      api
        .get<{ items: Medicine[] }>('/medicines', { q: text, limit: RESULTS })
        .then((result) => {
          if (mine !== latest.current) return;
          setFound(result.items.filter((m) => !m.retired));
          setFailed(false);
        })
        .catch(() => {
          if (mine !== latest.current) return;
          setFound([]);
          setFailed(true);
        })
        .finally(() => {
          if (mine === latest.current) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, query]);

  const byId = new Map(found.map((m) => [m.id, m]));
  return (
    <Combobox
      label={label ?? t('medicines:combobox.label')}
      hint={t('medicines:combobox.hint')}
      options={found.map((m) => medicineOption(m, t))}
      value={value ? medicineOption(value, t) : null}
      filter={false}
      minChars={MIN_CHARS}
      maxVisible={RESULTS}
      busy={busy}
      busyText={t('medicines:combobox.searching')}
      emptyText={failed ? t('medicines:combobox.failed') : t('medicines:combobox.empty')}
      onQueryChange={setQuery}
      onChange={(option) => onChange(option ? (byId.get(option.id) ?? null) : null)}
      {...(inputId ? { inputId } : {})}
      {...(error ? { error } : {})}
    />
  );
}
