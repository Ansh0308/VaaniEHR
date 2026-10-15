// RecordBar (PRD PG-06, FR-F1-01): Start is disabled, with a visible reason, until consent for audio AND AI
// processing is on record. Stub: no microphone yet (Phase 4); the waveform area is a labelled placeholder.
import { Mic, Pause, Play, Square } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

export type RecordState = 'idle' | 'recording' | 'paused' | 'processing' | 'error';

export interface RecordBarProps {
  state: RecordState;
  elapsedSeconds: number;
  consent: { audio: boolean; aiProcessing: boolean };
  /** Shown in research mode only (which ASR engine is active). */
  engine?: string;
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

export function RecordBar({
  state,
  elapsedSeconds,
  consent,
  engine,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordBarProps) {
  const { t } = useTranslation('clinical');
  const reasonId = useId();
  const consentOk = consent.audio && consent.aiProcessing;
  const active = state === 'recording';
  return (
    <section
      aria-label={t('clinical:record.region')}
      className="rounded-lg border border-control bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2" role="status">
          <Mic aria-hidden="true" className="size-5 text-ink" />
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
        {/* waveform area: decorative bars; animation only when recording and motion is allowed */}
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
                active ? 'motion-safe:animate-[vaani-wave_1s_ease-in-out_infinite]' : 'opacity-40',
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
          {state === 'recording' ? (
            <Button icon={Pause} onClick={onPause}>
              {t('clinical:record.pause')}
            </Button>
          ) : null}
          {state === 'paused' ? (
            <Button variant="primary" icon={Play} onClick={onResume}>
              {t('clinical:record.resume')}
            </Button>
          ) : null}
          {state === 'recording' || state === 'paused' ? (
            <Button icon={Square} onClick={onStop}>
              {t('clinical:record.stop')}
            </Button>
          ) : null}
        </div>
      </div>
      {!consentOk ? (
        <p id={reasonId} className="mt-3 text-sm font-semibold text-acknowledge-fg">
          {t('clinical:record.noConsent')}
        </p>
      ) : null}
      {state === 'error' ? (
        <p className="mt-3 text-sm font-semibold text-blocked-fg">{t('clinical:record.error')}</p>
      ) : null}
      {engine ? (
        <p className="mt-2 text-xs text-body">{t('clinical:record.engine', { engine })}</p>
      ) : null}
    </section>
  );
}
