// PG-06 Consultation (doctor): consent-gated recording and a DRAFT live transcript (Phase 4B Run 1).
// Recording needs audio + AI-processing consent on record (the server enforces it again when the token is issued and
// while streaming). Transcript edits stay in this page's memory for now; saving comes with the transcript API.
import { CircleAlert, CircleCheck, FileCheck2, LoaderCircle, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useAsrRecording } from '../asr/useAsrRecording';
import { fromSaved, useTranscriptSave, type SavedTranscript } from '../asr/useTranscriptSave';
import { errorText } from '../api/errorText';
import type { ConsentState } from '../api/types';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { RecordBar } from '../components/clinical/RecordBar';
import { TranscriptPane, type TranscriptSegment } from '../components/clinical/TranscriptPane';
import { NeedsReview } from '../components/NeedsReview';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Overlay';
import { useToast } from '../components/ui/Toast';
import { Skeleton } from '../components/ui/Feedback';

export function ConsultPage() {
  const { t, i18n } = useTranslation('consult');
  const { sessionId = '' } = useParams();
  const { api } = useAuth();
  const consent = useRequest(
    () => api.get<ConsentState>(`/sessions/${sessionId}/consent`),
    [api, sessionId],
  );
  const rec = useAsrRecording(sessionId);
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const save = useTranscriptSave(sessionId, rec.segments, { onConfirmed: () => rec.lockAll() });

  // a doctor coming back sees what was saved before (confirmed segments are shown locked)
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    let alive = true;
    api
      .get<SavedTranscript>(`/sessions/${sessionId}/transcript`)
      .then((saved) => {
        if (!alive || hydrated.current || saved.segments.length === 0) return;
        hydrated.current = true;
        const live = fromSaved(saved.segments);
        rec.load(live);
        save.markSaved(live);
      })
      .catch(() => undefined); // nothing saved yet, or not readable: start empty
    return () => {
      alive = false;
    };
  }, [api, sessionId]);

  // when a recording ends, what is still unsaved is saved at once
  useEffect(() => {
    if (rec.state === 'idle' || rec.state === 'error') void save.saveNow();
  }, [rec.state]);

  // a withdrawal reported by the speech service means the stored consent state changed: read it again
  useEffect(() => {
    if (rec.error === 'consent_withdrawn') consent.reload();
  }, [rec.error]);

  const segments: TranscriptSegment[] = [
    ...rec.segments.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      text: s.text,
      lang: s.language ?? '',
      final: true,
      startMs: s.startMs,
      endMs: s.endMs,
      originalText: s.originalText,
      edited: s.edited,
      locked: s.locked,
    })),
    ...(rec.partial
      ? [
          {
            id: 'partial',
            speaker: rec.nextSpeaker,
            text: rec.partial.text,
            lang: rec.partial.language ?? '',
            final: false,
            // a partial result has no real timestamps: the position is only approximate
            endMs: rec.elapsed * 1000,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('consult:title')}</h1>
        <p className="mt-1 text-base text-body">{t('consult:intro')}</p>
        {i18n.language === 'gu' ? <NeedsReview /> : null}
      </header>

      {consent.state.status === 'loading' ? (
        <Skeleton lines={2} label={t('consult:status.connecting')} />
      ) : consent.state.status === 'error' ? (
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={consent.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, consent.state.error)}
        </Banner>
      ) : (
        <RecordBar
          state={rec.state}
          elapsedSeconds={rec.elapsed}
          consent={{
            audio: consent.state.data.scopes.audio.granted,
            aiProcessing: consent.state.data.scopes.ai_processing.granted,
          }}
          consentLink={`/consult/${sessionId}/consent`}
          errorKind={rec.error}
          reconnecting={rec.reconnecting}
          level={rec.level}
          quiet={rec.quiet}
          nextSpeaker={rec.nextSpeaker}
          onNextSpeaker={rec.setNextSpeaker}
          onStart={rec.start}
          onStop={rec.stop}
        />
      )}

      {rec.state === 'idle' && rec.lastRun && rec.lastRun.finals === 0 ? (
        <Banner kind="acknowledge" live>
          {t('consult:run.noSpeech', {
            heard: rec.lastRun.audioSeconds.toFixed(1),
            engine: (rec.lastRun.engineSeconds ?? rec.lastRun.audioSeconds).toFixed(1),
          })}
        </Banner>
      ) : null}

      <TranscriptPane segments={segments} onSpeaker={rec.setSpeaker} onEditSave={rec.editText} />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card p-4">
        <p
          role="status"
          className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink"
        >
          {save.state === 'saving' ? (
            <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
          ) : save.state === 'saved' ? (
            <CircleCheck aria-hidden="true" className="size-5" />
          ) : (
            <CircleAlert aria-hidden="true" className="size-5" />
          )}
          {t(`consult:save.${save.state}`)}
        </p>
        {save.state === 'unsaved' || save.state === 'error' ? (
          <Button icon={Save} onClick={() => void save.saveNow()}>
            {t('consult:save.saveNow')}
          </Button>
        ) : null}
        <Button
          variant="primary"
          icon={FileCheck2}
          disabled={
            rec.segments.length === 0 ||
            rec.segments.every((s) => s.locked) ||
            rec.state === 'recording' ||
            rec.state === 'connecting' ||
            save.state === 'blocked'
          }
          onClick={() => setConfirmOpen(true)}
        >
          {t('consult:confirm.button')}
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('consult:confirm.title')}
        description={t('consult:confirm.body')}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>{t('consult:confirm.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() =>
                void save.confirm().then((ok) => {
                  setConfirmOpen(false);
                  toast.push(
                    ok
                      ? { kind: 'clear', title: t('consult:confirm.done') }
                      : { kind: 'blocked', title: t('consult:confirm.failed') },
                  );
                })
              }
            >
              {t('consult:confirm.yes')}
            </Button>
          </>
        }
      >
        <p className="text-base text-ink">{t('consult:draftNote')}</p>
      </Modal>
    </div>
  );
}
