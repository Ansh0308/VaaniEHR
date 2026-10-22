// SignDiff (PG-09, Phase 8 Run 2): what the engine proposed beside what will be signed. Nothing is invented: where no
// engine version exists the row says "doctor-entered". Facts: the engine's own text and evidence beside the doctor's final.
// Working condition: the engine's candidates beside the doctor's selection. Medicine rows: a template line (the template's
// original) beside the edited row; a row typed or picked by the doctor has no original. On a phone the two sides stack and
// each side keeps its own visible label.
import { useTranslation } from 'react-i18next';
import type { Preview, PreviewFact, PreviewMedicine } from '../../api/prescription';
import { Badge } from '../ui/Badge';
import { cn } from '../ui/cn';

function Pair({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-line bg-sunken p-3">
        <p className="text-xs font-semibold text-body">{leftLabel}</p>
        <div className="mt-1 text-sm text-ink">{left}</div>
      </div>
      <div className="rounded-md border border-control bg-card p-3">
        <p className="text-xs font-semibold text-body">{rightLabel}</p>
        <div className="mt-1 text-sm text-ink">{right}</div>
      </div>
    </div>
  );
}

function factText(
  t: (k: string) => string,
  value: string,
  negated: boolean,
  uncertain: boolean,
): string {
  return [
    value,
    negated ? t('consult:diff.negated') : null,
    uncertain ? t('consult:diff.uncertain') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function FactRow({ f }: { f: PreviewFact }) {
  const { t } = useTranslation('consult');
  const label = t(`consult:facts.type.${f.type}`);
  const engine =
    f.source === 'manual' ? (
      <p>{t('consult:diff.doctorEntered')}</p>
    ) : (
      <>
        <p>
          {factText(
            t,
            f.originalValue ?? f.value,
            f.originalNegated ?? f.negated,
            f.originalUncertain ?? f.uncertain,
          )}
        </p>
        {f.evidenceQuote ? (
          <p className="mt-1 text-xs text-body">
            {t('consult:diff.evidence')}: “{f.evidenceQuote}”
          </p>
        ) : null}
      </>
    );
  const final =
    f.status === 'rejected' ? (
      <p>
        <Badge>{t('consult:diff.removed')}</Badge>
      </p>
    ) : f.status === 'confirmed' ? (
      <>
        <p>{factText(t, f.value, f.negated, f.uncertain)}</p>
        <p className="mt-1">
          <Badge>
            {f.source === 'manual'
              ? t('consult:diff.doctorEntered')
              : f.edited
                ? t('consult:diff.edited')
                : t('consult:diff.unchanged')}
          </Badge>
        </p>
      </>
    ) : (
      <p className="font-semibold">{t('consult:diff.notConfirmed')}</p>
    );
  return (
    <li aria-label={`${label}: ${f.value}`} className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-ink">{label}</h4>
      <Pair
        left={engine}
        right={final}
        leftLabel={t('consult:diff.engine')}
        rightLabel={t('consult:diff.final')}
      />
    </li>
  );
}

const line = (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ');

function MedicineRow({ m }: { m: PreviewMedicine }) {
  const { t } = useTranslation(['consult', 'templates']);
  const freq = (code: string | null) => (code ? t(`templates:frequency.${code}`, code) : null);
  const o = m.templateOriginal;
  const changed = o
    ? [
        (o.dose ?? null) !== (m.dose ?? null) ? t('consult:prescription.field.dose') : null,
        (o.frequency ?? null) !== (m.frequency ?? null)
          ? t('consult:prescription.field.frequency')
          : null,
        (o.duration ?? null) !== (m.duration ?? null)
          ? t('consult:prescription.field.duration')
          : null,
        (o.instructions ?? null) !== (m.note ?? null) ? t('consult:prescription.field.note') : null,
      ].filter(Boolean)
    : [];
  return (
    <li aria-label={m.name} className="flex flex-col gap-2">
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        {m.name}
        {m.source === 'free_text' ? <Badge>{t('consult:prescription.notInMaster')}</Badge> : null}
      </h4>
      <Pair
        leftLabel={
          o ? t('consult:diff.template', { name: o.templateName }) : t('consult:diff.engine')
        }
        rightLabel={t('consult:diff.final')}
        left={
          o ? (
            <p>
              {line([o.dose, freq(o.frequency), o.duration, o.instructions]) ||
                t('consult:diff.templateEmpty')}
            </p>
          ) : (
            <p>{t('consult:diff.doctorEntered')}</p>
          )
        }
        right={
          <>
            <p>{line([m.strength, m.doseForm])}</p>
            <p>{line([m.dose, freq(m.frequency), m.duration, m.note])}</p>
            <p className={cn('mt-1')}>
              <Badge>
                {!o
                  ? t('consult:diff.doctorEntered')
                  : changed.length > 0
                    ? t('consult:diff.changedFields', { fields: changed.join(', ') })
                    : t('consult:diff.unchanged')}
              </Badge>
            </p>
          </>
        }
      />
    </li>
  );
}

export function SignDiff({ preview }: { preview: Preview }) {
  const { t } = useTranslation('consult');
  const wc = preview.workingCondition;
  const shown = preview.facts.filter((f) => f.status !== 'rejected' || f.source === 'extracted');
  return (
    <section
      aria-label={t('consult:diff.region')}
      className="flex flex-col gap-5 rounded-lg border border-line bg-card p-4"
    >
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">{t('consult:diff.title')}</h2>
        <p className="mt-1 text-sm text-body">{t('consult:diff.intro')}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-ink">{t('consult:diff.facts')}</h3>
        {shown.length === 0 ? (
          <p className="text-sm text-body">{t('consult:diff.noFacts')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {shown.map((f) => (
              <FactRow key={f.id} f={f} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-ink">{t('consult:diff.condition')}</h3>
        <Pair
          leftLabel={t('consult:diff.engine')}
          rightLabel={t('consult:diff.final')}
          left={
            preview.engineCandidates.length === 0 ? (
              <p>{t('consult:diff.noCandidates')}</p>
            ) : (
              <ol className="list-decimal ps-5">
                {preview.engineCandidates.map((c) => (
                  <li key={`${c.pathwayId}:${c.version}`}>
                    {t('consult:diff.pathwayVersion', { id: c.pathwayId, version: c.version })}
                  </li>
                ))}
              </ol>
            )
          }
          right={
            !wc ? (
              <p>{t('consult:diff.noCondition')}</p>
            ) : wc.kind === 'not_listed' ? (
              <p>
                {t('consult:diff.notListed', { text: wc.text ?? '' })}{' '}
                <Badge>{t('consult:diff.doctorEntered')}</Badge>
              </p>
            ) : (
              <p>
                {t('consult:diff.pathwayVersion', {
                  id: wc.pathwayId ?? '',
                  version: wc.version ?? 0,
                })}{' '}
                <Badge>
                  {wc.engineRank !== null
                    ? t('consult:diff.pickedRank', { rank: wc.engineRank })
                    : t('consult:diff.pickedOutside')}
                </Badge>
              </p>
            )
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-ink">{t('consult:diff.medicines')}</h3>
        {preview.medicines.length === 0 ? (
          <p className="text-sm text-body">{t('consult:diff.noMedicines')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {preview.medicines.map((m) => (
              <MedicineRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
