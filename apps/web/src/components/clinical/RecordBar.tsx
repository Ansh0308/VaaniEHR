// RecordBar (PRD PG-06, FR-F1-01, FR-F2-01). Start is disabled, with a visible reason and a link to the consent
// screen, until consent for audio AND AI processing is on record. The state is always written in words with an icon
// (never colour alone), a live region announces changes, errors use role="alert", and every control is at least 44px.
import { Circle, Mic, Pause, Play, ShieldAlert, Square } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

export type RecordState = 'idle' | 'connecting' | 'recording' | 'paused' | 'processing' | 'error';
export type NextSpeaker = 'unknown' | 'doctor' | 'patient';

export interface RecordBarProps {
  state: RecordState;
  elapsedSeconds: number;
  consent: { audio: boolean; aiProcessing: boolean };
  /** Where the missing-consent message sends people (the existing consent screen). */
  consentLink?: string;
  /** Shown in research mode only (which ASR engine is active). */
  engine?: string;
  /** Why the last recording stopped (a key under consult:error). */
  errorKind?: string | null;
  reconnecting?: boolean;
  nextSpeaker?: NextSpeaker;
  onNextSpeaker?: (speaker: NextSpeaker) => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

const BARS = [0.4, 0.7, 0.5, 0.9, 0.6, 1, 0.45, 0.8, 0.55, 0.95, 0.5, 0.75, 0.4, 0.65, 0.85, 0.5];
const SPEAKERS: NextSpeaker[] = ['unknown', 'doctor', 'patient'];

export function RecordBar({
  state,
  elapsedSeconds,
  consent,
  consentLink,
  engine,
  errorKind,
  reconnecting = false,
  nextSpeaker,
  onNextSpeaker,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordBarProps) {
  const { t } = useTranslation('clinical');
  const reasonId = useId();
  const consentOk = consent.audio && consent.aiProcessing;
  const live = state === 'recording';
  const busy = state === 'connecting' || state === 'processing';
  const missing = [
    ...(consent.audio ? [] : [t('consult:consent.audio')]),
    ...(consent.aiProcessing ? [] : [t('consult:consent.aiProcessing')]),
  ].join(', ');
  const statusKey = reconnecting ? 'reconnecting' : state === 'paused' ? 'idle' : state;
  return (
    <section
      aria-label={t('clinical:record.region')}
      className="rounded-lg border border-control bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-h-11 items-center gap-2">
          {live ? (
            <Circle
              aria-hidden="true"
              className="size-5 fill-current text-ink motion-safe:animate-pulse"
            />
          ) : (
            <Mic aria-hidden="true" className="size-5 text-ink" />
          )}
          <span className="text-base font-semibold text-ink">
            {t(`clinical:record.state.${state}`)}
          </span>
        </div>
        <time
          dateTime={`PT${Math.floor(elapsedSeconds)}S`}
          className="text-xl font-semibold text-ink tabular-nums"
          aria-hidden="true"
        >
          {formatElapsed(elapsedSeconds)}
        </time>
        <span className="sr-only">
          {t('clinical:record.elapsed', { time: formatElapsed(elapsedSeconds) })}
        </span>
        {/* decorative level bars; they move only while recording and when motion is allowed */}
        <div
          role="img"
          aria-label={t('clinical:record.waveform')}
          className="flex h-11 min-w-40 flex-1 items-center gap-1 rounded-md bg-sunken px-3"
        >
          {BARS.map((height, index) => (
            <span
              key={index}
              aria-hidden="true"
              style={{ height: `${Math.round(height * 100)}%`, animationDelay: `${index * 60}ms` }}
              className={cn(
                'w-1 origin-center rounded-sm bg-ink',
                live ? 'motion-safe:animate-[vaani-wave_1s_ease-in-out_infinite]' : 'opacity-40',
              )}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {state === 'idle' || state === 'error' ? (
            <Button
              variant="primary"
              icon={Play}
              onClick={onStart}
              disabled={!consentOk}
              aria-describedby={consentOk ? undefined : reasonId}
            >
              {t('clinical:record.start')}
            </Button>
          ) : null}
          {live && onPause ? (
            <Button icon={Pause} onClick={onPause}>
              {t('clinical:record.pause')}
            </Button>
          ) : null}
          {state === 'paused' ? (
            <Button variant="primary" icon={Play} onClick={onResume}>
              {t('clinical:record.resume')}
            </Button>
          ) : null}
          {live || state === 'paused' || state === 'connecting' ? (
            <Button icon={Square} onClick={onStop} disabled={busy && !live}>
              {t('clinical:record.stop')}
            </Button>
          ) : null}
        </div>
      </div>

      {nextSpeaker && onNextSpeaker ? (
        <fieldset className="mt-3 flex flex-wrap items-center gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">
            {t('consult:nextSpeaker.legend')}
          </legend>
          {SPEAKERS.map((speaker) => (
            <label
              key={speaker}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-base text-ink',
                nextSpeaker === speaker
                  ? 'border-ink bg-selected font-semibold'
                  : 'border-control bg-card',
              )}
            >
              <input
                type="radio"
                name="next-speaker"
                value={speaker}
                checked={nextSpeaker === speaker}
                onChange={() => onNextSpeaker(speaker)}
                className="size-5 accent-[var(--color-action)]"
              />
              {t(`consult:nextSpeaker.${speaker}`)}
            </label>
          ))}
        </fieldset>
      ) : null}

      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-body">
        {consentOk ? (
          t('consult:consent.ok')
        ) : (
          <>
            <span id={reasonId} className="font-semibold text-acknowledge-fg">
              {t('consult:consent.missing', { list: missing })}
            </span>
            {consentLink ? (
              <Link
                to={consentLink}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-control bg-card px-3 font-semibold text-ink underline"
              >
                <ShieldAlert aria-hidden="true" className="size-5" />
                {t('consult:consent.link')}
              </Link>
            ) : null}
          </>
        )}
      </p>
      <p role="status" className="sr-only">
        {t(`consult:status.${statusKey}`)}
      </p>
      {state === 'error' ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-blocked-fg">
          {errorKind ? t(`consult:error.${errorKind}`) : t('clinical:record.error')}
        </p>
      ) : null}
      {engine ? (
        <p className="mt-2 text-xs text-body">{t('clinical:record.engine', { engine })}</p>
      ) : null}
    </section>
  );
}
