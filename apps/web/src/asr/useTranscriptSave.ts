// Autosave of the draft transcript and the doctor's "Confirm" (ADR-D28). The text goes only to the API (HTTPS body):
// never to the console, a URL, or any browser storage. Edits and speaker choices are saved a moment after they stop.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { LiveSegment, Speaker } from './useAsrRecording';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'blocked';

export interface SavedSegment {
  seq: number;
  speaker: Speaker;
  originalText: string;
  editedText: string | null;
  text: string;
  language: string | null;
  startMs: number | null;
  endMs: number | null;
  engine: string;
  engineVersion: string | null;
  status: 'draft' | 'confirmed';
}

export interface SavedTranscript {
  segments: SavedSegment[];
  draftCount: number;
  confirmedCount: number;
}

export const DEBOUNCE_MS = 1500;
const RETRY_MS = 5000;
const MAX_AUTOMATIC_RETRIES = 5;
const BATCH = 200;

const signature = (s: LiveSegment) => JSON.stringify([s.speaker, s.text]);

export function fromSaved(saved: SavedSegment[]): LiveSegment[] {
  return saved.map((s) => ({
    id: `seg-${s.seq}`,
    seq: s.seq,
    engine: s.engine,
    engineVersion: s.engineVersion,
    locked: s.status === 'confirmed',
    startMs: s.startMs ?? 0,
    endMs: s.endMs ?? 0,
    text: s.text,
    originalText: s.originalText,
    edited: s.editedText !== null,
    language: s.language,
    speaker: s.speaker,
  }));
}

export function useTranscriptSave(
  sessionId: string,
  segments: LiveSegment[],
  options: { onConfirmed: () => void },
) {
  const { api } = useAuth();
  const [state, setState] = useState<SaveState>('saved');
  const lastSaved = useRef(new Map<number, string>());
  const inFlight = useRef(false);
  const retries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(segments);
  latest.current = segments;

  const dirty = useCallback(
    () => latest.current.filter((s) => !s.locked && lastSaved.current.get(s.seq) !== signature(s)),
    [],
  );

  /** Marks what is already on the server as saved (segments loaded from it). */
  const markSaved = useCallback((list: LiveSegment[]) => {
    for (const s of list) lastSaved.current.set(s.seq, signature(s));
  }, []);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current) return false;
    const pending = dirty();
    if (pending.length === 0) {
      setState((s) => (s === 'blocked' ? s : 'saved'));
      return true;
    }
    inFlight.current = true;
    setState('saving');
    try {
      for (let i = 0; i < pending.length; i += BATCH) {
        const batch = pending.slice(i, i + BATCH);
        await api.put(`/sessions/${sessionId}/transcript/segments`, {
          segments: batch.map((s) => ({
            seq: s.seq,
            speaker: s.speaker,
            originalText: s.originalText,
            editedText: s.text !== s.originalText ? s.text : null,
            language: s.language,
            startMs: s.startMs,
            endMs: s.endMs,
            engine: s.engine,
            engineVersion: s.engineVersion,
          })),
        });
        for (const s of batch) lastSaved.current.set(s.seq, signature(s));
      }
      retries.current = 0;
      inFlight.current = false;
      const left = dirty().length;
      setState(left === 0 ? 'saved' : 'unsaved');
      return left === 0;
    } catch (error) {
      inFlight.current = false;
      const consentGone = error instanceof ApiError && error.code === 'CONSENT_REQUIRED';
      setState(consentGone ? 'blocked' : 'error');
      return false;
    }
  }, [api, dirty, sessionId]);

  // when the text or a speaker changes, save shortly after the changes stop
  useEffect(() => {
    if (state === 'blocked') return;
    if (dirty().length === 0) return;
    setState((s) => (s === 'saving' ? s : 'unsaved'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [segments, dirty, saveNow, state]);

  // a failed save is tried again a few times, then left to the "Save now" button
  useEffect(() => {
    if (state !== 'error' || retries.current >= MAX_AUTOMATIC_RETRIES) return;
    const id = setTimeout(() => {
      retries.current += 1;
      void saveNow();
    }, RETRY_MS);
    return () => clearTimeout(id);
  }, [state, saveNow]);

  const confirm = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    if (dirty().length > 0 && !(await saveNow())) return false;
    try {
      await api.post(`/sessions/${sessionId}/transcript/confirm`);
    } catch (error) {
      const consentGone = error instanceof ApiError && error.code === 'CONSENT_REQUIRED';
      setState(consentGone ? 'blocked' : 'error');
      return false;
    }
    options.onConfirmed();
    setState('saved');
    return true;
  }, [api, dirty, options, saveNow, sessionId]);

  return { state, saveNow, confirm, markSaved };
}
