// PG-06 Consultation (doctor): consent-gated recording and a DRAFT live transcript (Phase 4B Run 1).
// Recording needs audio + AI-processing consent on record (the server enforces it again when the token is issued and
// while streaming). Transcript edits stay in this page's memory for now; saving comes with the transcript API.
import { CircleAlert, CircleCheck, FileCheck2, LoaderCircle, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAsrRecording } from '../asr/useAsrRecording';
import { fromSaved, useTranscriptSave, type SavedTranscript } from '../asr/useTranscriptSave';
import { errorText } from '../api/errorText';
import type { ConsentState } from '../api/types';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { CandidatesPanel } from '../components/clinical/CandidatesPanel';
import { FactsPanel, type ExtractBlock } from '../components/clinical/FactsPanel';
import { PrescriptionTab } from '../components/clinical/PrescriptionTab';
import { PreviousVisits } from '../components/clinical/PreviousVisits';
import type { PreviousVisit } from '../api/prescription';
import { QuestionPanel } from '../components/clinical/QuestionPanel';
import { RedFlagBanner } from '../components/clinical/RedFlagBanner';
import { RecordBar } from '../components/clinical/RecordBar';
import { TranscriptPane, type TranscriptSegment } from '../components/clinical/TranscriptPane';
import { NeedsReview } from '../components/NeedsReview';
import type { PathwayLang } from '../api/pathwayAids';
import { useFacts, type Fact } from '../facts/useFacts';
import { usePrescription } from '../prescription/usePrescription';
import type { TemplateList } from '../api/templates';
import { useConceptSuggestions } from '../facts/useConceptSuggestions';
import { usePathwayAids } from '../facts/usePathwayAids';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Overlay';
import { useToast } from '../components/ui/Toast';
import { Skeleton } from '../components/ui/Feedback';
import { Tabs } from '../components/ui/Tabs';

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
  const facts = useFacts(sessionId);
  const consentOk =
    consent.state.status === 'ready' &&
    consent.state.data.scopes.audio.granted &&
    consent.state.data.scopes.ai_processing.granted;
  // Phase 6C: the pathway aids are read again when confirmed or rejected facts change, never on keystrokes
  const [questionLang, setQuestionLang] = useState<PathwayLang>(
    i18n.language === 'gu' ? 'gu' : 'en',
  );
  const refreshKey = facts.facts
    .filter((f) => f.status === 'confirmed' || f.status === 'rejected')
    .map((f) => `${f.id}:${f.status}:${f.conceptStatus}:${f.conceptId ?? ''}`)
    .sort()
    .join(',');
  const aids = usePathwayAids(sessionId, { lang: questionLang, consentOk, refreshKey });
  // concept suggestions are read again when the facts, their words or a link change
  const conceptsKey = facts.facts
    .filter((f) => f.type === 'symptom' && f.status !== 'rejected')
    .map((f) => `${f.id}:${f.value}:${f.conceptStatus}`)
    .sort()
    .join(',');
  const concepts = useConceptSuggestions(sessionId, {
    lang: questionLang,
    consentOk,
    key: conceptsKey,
    onLinkChanged: facts.reload,
  });
  const [peek, setPeek] = useState<Fact | null>(null);
  const rx = usePrescription(sessionId);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const previous = useRequest(
    () => api.get<{ visits: PreviousVisit[] }>(`/sessions/${sessionId}/previous-visits`),
    [api, sessionId],
  );
  // a "fix this" link from the sign page lands on its section: scroll to it and move focus there
  useEffect(() => {
    const id = location.hash.replace('#', '');
    if (!id) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(id);
      tries += 1;
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
        clearInterval(timer);
      } else if (tries > 20) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [location.hash]);
  const templates = useRequest(() => api.get<TemplateList>('/templates', { limit: 100 }), [api]);

  // after a save the server may have marked facts stale (their words changed): read the list again
  useEffect(() => {
    if (save.state === 'saved') void facts.reload();
  }, [save.state]);

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
      ...(peek && peek.evidenceQuote && peek.sourceSegmentSeq === s.seq
        ? { mark: peek.evidenceQuote }
        : {}),
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

  const blocked: ExtractBlock = !consentOk
    ? 'consent'
    : rec.state === 'recording' || rec.state === 'connecting'
      ? 'recording'
      : rec.segments.length === 0
        ? 'empty'
        : save.state !== 'saved'
          ? 'unsaved'
          : null;

  const consultPanel = (
    <>
      <PreviousVisits
        visits={previous.state.status === 'ready' ? previous.state.data.visits : null}
      />
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

      {rec.error === 'service_down' ||
      rec.error === 'not_configured' ||
      rec.error === 'engine' ||
      rec.error === 'connection_lost' ? (
        <Banner kind="acknowledge" live title={t('consult:asrDown.title')}>
          {t('consult:asrDown.body')}
        </Banner>
      ) : null}

      {rec.state === 'idle' && rec.lastRun && rec.lastRun.finals === 0 ? (
        <Banner kind="acknowledge" live>
          {t('consult:run.noSpeech', {
            heard: rec.lastRun.audioSeconds.toFixed(1),
            engine: (rec.lastRun.engineSeconds ?? rec.lastRun.audioSeconds).toFixed(1),
          })}
        </Banner>
      ) : null}

      <TranscriptPane segments={segments} onSpeaker={rec.setSpeaker} onEditSave={rec.editText} />

      <FactsPanel
        facts={facts.facts}
        sentenceOf={(seq) =>
          seq === null ? null : (rec.segments.find((s) => s.seq === seq)?.text ?? null)
        }
        mode={facts.mode}
        blocked={blocked}
        busy={facts.busy}
        extracting={facts.extracting}
        error={facts.error}
        announcement={facts.announcement}
        onExtract={() => void facts.extract()}
        onConfirm={(id) => void facts.confirm(id)}
        onReject={(id) => void facts.reject(id)}
        onEdit={(id, body) => void facts.edit(id, body)}
        onAdd={facts.add}
        onPeek={setPeek}
        concepts={{
          data: concepts.data,
          busy: concepts.busy,
          error: concepts.error,
          onConfirm: (factId, conceptId) => void concepts.confirm(factId, conceptId),
          onClear: (factId) => void concepts.clear(factId),
        }}
      />

      <QuestionPanel
        consentOk={consentOk}
        loading={aids.loading}
        busy={aids.busy}
        error={aids.error}
        next={aids.next}
        record={aids.record}
        lang={questionLang}
        onLang={setQuestionLang}
        onAct={(eventId, action) => void aids.act(eventId, action)}
      />

      <CandidatesPanel
        consentOk={consentOk}
        loading={aids.loading}
        busy={aids.busy}
        error={aids.error}
        list={aids.candidates}
        record={aids.record}
        facts={facts.facts}
        onSelect={(body) => void aids.select(body)}
        onUndo={() => void aids.undo()}
      />

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
    </>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('consult:title')}</h1>
        <p className="mt-1 text-base text-body">{t('consult:intro')}</p>
        {i18n.language === 'gu' ? <NeedsReview /> : null}
      </header>

      <div id="red-flag-region">
        <RedFlagBanner
          next={aids.next}
          busy={aids.busy}
          onAcknowledge={(eventId) => void aids.act(eventId, 'acknowledged')}
        />
      </div>

      <Tabs
        label={t('consult:tabs.label')}
        keepMounted
        defaultId={searchParams.get('tab') === 'prescription' ? 'prescription' : 'consult'}
        tabs={[
          {
            id: 'consult',
            label: t('consult:tabs.consult'),
            panel: <div className="flex flex-col gap-6">{consultPanel}</div>,
          },
          {
            id: 'prescription',
            label: t('consult:tabs.prescription'),
            panel: (
              <PrescriptionTab
                rows={rx.rows}
                locked={rx.locked}
                loading={rx.loading}
                busy={rx.busy}
                error={rx.error}
                templates={
                  templates.state.status === 'ready'
                    ? templates.state.data.items.filter((x) => !x.retired)
                    : null
                }
                onAdd={rx.add}
                onEdit={rx.edit}
                onRemove={(id) => void rx.remove(id)}
                onApplyTemplate={rx.applyTemplate}
                signHref={rx.locked ? `/consult/${sessionId}/record` : `/consult/${sessionId}/sign`}
              />
            ),
          },
        ]}
      />

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
