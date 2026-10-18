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
            counter.current += 1;
            setPartial(null);
            setSegments((list) => [
              ...list,
              {
                id: `seg-${counter.current}`,
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
      setSegments((list) => list.map((s) => (s.id === id ? { ...s, speaker } : s))),
    [],
  );
  const editText = useCallback(
    (id: string, text: string) =>
      setSegments((list) =>
        list.map((s) =>
          s.id === id ? { ...s, text, edited: text.trim() !== s.originalText.trim() } : s,
        ),
      ),
    [],
  );

  return {
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
