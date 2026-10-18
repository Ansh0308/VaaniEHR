// React glue for AsrClient: state for the RecordBar and the (draft) transcript. Everything here lives in memory only.
// Edits to a segment stay in memory in this run (saving comes with the transcript API); the original text is kept.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  AsrClient,
  type AsrDeps,
  type AsrErrorKind,
  type AsrState,
  type WireSegment,
} from './AsrClient';
import { createBrowserCapture, openBrowserSocket } from './browser';

export type Speaker = 'unknown' | 'doctor' | 'patient';

export interface LiveSegment {
  id: string;
  /** order number within the session (the key used when the transcript is saved) */
  seq: number;
  engine: string;
  engineVersion: string | null;
  /** confirmed by the doctor: part of the record, no longer editable */
  locked: boolean;
  startMs: number;
  endMs: number;
  text: string;
  /** what the engine said, kept when the doctor edits the text */
  originalText: string;
  edited: boolean;
  language: string | null;
  speaker: Speaker;
}

export interface PartialText {
  text: string;
  language: string | null;
}

export function useAsrRecording(sessionId: string, makeDeps?: () => AsrDeps) {
  const { api } = useAuth();
  const [state, setState] = useState<AsrState>('idle');
  const [error, setError] = useState<AsrErrorKind | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [partial, setPartial] = useState<PartialText | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [nextSpeaker, setNextSpeaker] = useState<Speaker>('unknown');
  const nextSpeakerRef = useRef<Speaker>('unknown');
  nextSpeakerRef.current = nextSpeaker;
  const counter = useRef(0);

  const client = useMemo(
    () =>
      new AsrClient(
        makeDeps
          ? makeDeps()
          : {
              getToken: async () =>
                (await api.post<{ token: string }>(`/sessions/${sessionId}/asr-token`)).token,
              openSocket: () => openBrowserSocket(sessionId),
              createCapture: createBrowserCapture,
            },
        {
          onState: (next) => {
            setState(next);
            if (next === 'recording' || next === 'connecting') setError(null);
            if (next === 'idle' || next === 'error') setPartial(null);
          },
          onError: setError,
          onReconnecting: setReconnecting,
          onSegment: (wire: WireSegment) => {
            if (wire.kind === 'partial') {
              setPartial({ text: wire.text, language: wire.language });
              return;
            }
            const seq = counter.current;
            counter.current += 1;
            setPartial(null);
            setSegments((list) => [
              ...list,
              {
                id: `seg-${seq}`,
                seq,
                engine: wire.engine,
                engineVersion: wire.engineVersion ?? null,
                locked: false,
                startMs: wire.startMs,
                endMs: wire.endMs,
                text: wire.text,
                originalText: wire.text,
                edited: false,
                language: wire.language,
                // the engine gives no doctor/patient label: the doctor's "next speaker" choice is applied, default unknown
                speaker: nextSpeakerRef.current,
              },
            ]);
          },
        },
      ),
    // the client is created once per session page
    [sessionId],
  );

  // elapsed seconds while recording
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // leaving the page releases the microphone and the connection
  useEffect(() => () => client.dispose(), [client]);

  const start = useCallback(() => {
    if (state === 'idle' || state === 'error') {
      setElapsed(0);
      setError(null);
      void client.start('gu-IN');
    }
  }, [client, state]);
  const stop = useCallback(() => void client.stop(), [client]);
  const setSpeaker = useCallback(
    (id: string, speaker: Speaker) =>
      setSegments((list) => list.map((s) => (s.id === id && !s.locked ? { ...s, speaker } : s))),
    [],
  );
  const editText = useCallback(
    (id: string, text: string) =>
      setSegments((list) =>
        list.map((s) =>
          s.id === id && !s.locked
            ? { ...s, text, edited: text.trim() !== s.originalText.trim() }
            : s,
        ),
      ),
    [],
  );

  /** Puts previously saved segments on the screen (a doctor coming back to a session). */
  const load = useCallback((saved: LiveSegment[]) => {
    counter.current = saved.reduce((max, s) => Math.max(max, s.seq + 1), counter.current);
    setSegments(saved);
  }, []);
  const lockAll = useCallback(
    () => setSegments((list) => list.map((s) => ({ ...s, locked: true }))),
    [],
  );

  return {
    load,
    lockAll,
    state,
    error,
    reconnecting,
    segments,
    partial,
    elapsed,
    nextSpeaker,
    setNextSpeaker,
    start,
    stop,
    setSpeaker,
    editText,
  };
}
