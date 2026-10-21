// QuestionPanel (PRD F4, FR-F4-03, -04, -06, -07, -08; Phase 6C): the next question the pathway suggests, and why. The
// doctor decides everything: Asked / Dismiss / Snooze are buttons, nothing happens by itself, and the panel never gives a
// treatment. Outcomes: a question, a red flag (acknowledged elsewhere, see RedFlagBanner), "not enough information",
// "no further questions". Without consent it offers nothing and shows only what the doctor already decided.
import { CircleHelp, ClockArrowDown, MessageCircleQuestion, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NextQuestion, PathwayLang, PathwayRecord } from '../../api/pathwayAids';
import type { AidAction } from '../../facts/usePathwayAids';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { Skeleton } from '../ui/Feedback';

export interface QuestionPanelProps {
  consentOk: boolean;
  loading: boolean;
  busy: boolean;
  error: 'load' | 'save' | 'consent' | null;
  next: NextQuestion | null;
  record: PathwayRecord | null;
  lang: PathwayLang;
  onLang: (lang: PathwayLang) => void;
  onAct: (eventId: string, action: AidAction) => void;
}

export function TestPathwayBanner() {
  const { t } = useTranslation('consult');
  return (
    <p className="inline-flex items-center gap-2 rounded-md border border-dashed border-ink bg-sunken px-3 py-1 text-sm font-semibold text-ink">
      <CircleHelp aria-hidden="true" className="size-4 shrink-0" />
      {t('consult:pathway.testBanner')}
    </p>
  );
}

export function KeptRecord({ record }: { record: PathwayRecord | null }) {
  const { t } = useTranslation('consult');
  if (!record || (record.acknowledgedRedFlags.length === 0 && !record.selected)) return null;
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-line p-3"
      aria-label={t('consult:pathway.kept.title')}
      role="group"
    >
      <p className="text-sm font-semibold text-ink">{t('consult:pathway.kept.title')}</p>
      <p className="text-sm text-body">{t('consult:pathway.kept.readOnly')}</p>
      {record.acknowledgedRedFlags.map((r) => (
        <p key={r.eventId} className="flex items-center gap-2 text-base text-ink">
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
          {t('consult:pathway.kept.redFlag', { title: r.pathwayTitle ?? r.pathwayId })}
        </p>
      ))}
      {record.selected ? (
        <p className="text-base text-ink">
          {record.selected.notListed
            ? t('consult:pathway.kept.notListed', { text: record.selected.text ?? '' })
            : t('consult:pathway.kept.working', {
                title: record.selected.title ?? record.selected.pathwayId,
              })}
        </p>
      ) : null}
    </div>
  );
}

export function QuestionPanel(props: QuestionPanelProps) {
  const { t } = useTranslation('consult');
  const { next } = props;
  const notActive = next?.notActive ?? props.record?.notActive ?? false;
  return (
    <section
      aria-label={t('consult:pathway.questions.region')}
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t('consult:pathway.questions.title')}
        </h2>
        {props.consentOk && notActive ? <TestPathwayBanner /> : null}
      </div>
      <p className="text-sm font-semibold text-ink">{t('consult:pathway.aid')}</p>

      {!props.consentOk ? (
        <>
          <Banner kind="acknowledge">{t('consult:pathway.noConsent')}</Banner>
          <KeptRecord record={props.record} />
        </>
      ) : props.loading ? (
        <Skeleton lines={2} label={t('consult:pathway.loading')} />
      ) : props.error === 'load' ? (
        <Banner kind="blocked" live>
          {t('consult:pathway.error.load')}
        </Banner>
      ) : props.error === 'consent' ? (
        <Banner kind="acknowledge" live>
          {t('consult:pathway.noConsent')}
        </Banner>
      ) : next ? (
        <>
          {props.error === 'save' ? (
            <Banner kind="blocked" live>
              {t('consult:pathway.error.save')}
            </Banner>
          ) : null}
          <Select
            label={t('consult:pathway.questions.language')}
            value={props.lang}
            onChange={(event) => props.onLang(event.target.value as PathwayLang)}
            options={[
              { value: 'en', label: t('consult:pathway.lang.en') },
              { value: 'gu', label: t('consult:pathway.lang.gu') },
              { value: 'hi', label: t('consult:pathway.lang.hi') },
            ]}
          />
          {next.outcome === 'QUESTION' && next.eventId ? (
            <div
              className="flex flex-col gap-3 rounded-md border border-line p-3"
              data-outcome="QUESTION"
            >
              <p className="flex items-start gap-2 text-lg font-semibold text-ink">
                <MessageCircleQuestion aria-hidden="true" className="mt-1 size-5 shrink-0" />
                <span lang={props.lang}>{next.ask}</span>
              </p>
              <p className="text-base text-body">
                <span className="font-semibold text-ink">
                  {t('consult:pathway.questions.why')}{' '}
                </span>
                <span lang={props.lang}>{next.reasonText}</span>
              </p>
              <p className="text-sm text-body">
                {t('consult:pathway.questions.slot', { slot: next.slot })}
                {next.pathwayTitle ? ` - ${next.pathwayTitle}` : ''}
              </p>
              <p className="text-sm text-body">
                {t('consult:pathway.questions.count', {
                  used: next.questionsUsed,
                  cap: next.questionCap,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={props.busy}
                  onClick={() => props.onAct(next.eventId as string, 'asked')}
                >
                  {t('consult:pathway.questions.asked')}
                </Button>
                <Button
                  icon={X}
                  disabled={props.busy}
                  onClick={() => props.onAct(next.eventId as string, 'dismissed')}
                >
                  {t('consult:pathway.questions.dismiss')}
                </Button>
                <Button
                  icon={ClockArrowDown}
                  disabled={props.busy}
                  onClick={() => props.onAct(next.eventId as string, 'snoozed')}
                >
                  {t('consult:pathway.questions.snooze')}
                </Button>
              </div>
            </div>
          ) : next.outcome === 'RED_FLAG' ? (
            <p className="text-base text-ink" data-outcome="RED_FLAG">
              {next.eventStatus === 'acknowledged'
                ? t('consult:pathway.questions.redFlagAcknowledged')
                : t('consult:pathway.questions.redFlagOpen')}
            </p>
          ) : next.outcome === 'ABSTAIN' ? (
            <p className="text-base text-ink" data-outcome="ABSTAIN">
              {t('consult:pathway.questions.abstain')}
            </p>
          ) : (
            <p className="text-base text-ink" data-outcome="COMPLETE">
              {t('consult:pathway.questions.complete')}
            </p>
          )}
          {next.slotConflicts.length > 0 ? (
            <p className="text-sm text-body">
              {t('consult:pathway.questions.conflict', { slots: next.slotConflicts.join(', ') })}
            </p>
          ) : null}
          <KeptRecord record={props.record} />
        </>
      ) : null}
    </section>
  );
}
