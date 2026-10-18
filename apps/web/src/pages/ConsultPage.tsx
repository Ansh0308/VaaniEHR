// PG-06 Consultation (doctor): consent-gated recording and a DRAFT live transcript (Phase 4B Run 1).
// Recording needs audio + AI-processing consent on record (the server enforces it again when the token is issued and
// while streaming). Transcript edits stay in this page's memory for now; saving comes with the transcript API.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useAsrRecording } from '../asr/useAsrRecording';
import { errorText } from '../api/errorText';
import type { ConsentState } from '../api/types';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { RecordBar } from '../components/clinical/RecordBar';
import { TranscriptPane, type TranscriptSegment } from '../components/clinical/TranscriptPane';
import { NeedsReview } from '../components/NeedsReview';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
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
          nextSpeaker={rec.nextSpeaker}
          onNextSpeaker={rec.setNextSpeaker}
          onStart={rec.start}
          onStop={rec.stop}
        />
      )}

      <TranscriptPane segments={segments} onSpeaker={rec.setSpeaker} onEditSave={rec.editText} />
    </div>
  );
}
