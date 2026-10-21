// The pathway aids of one consultation (Phase 6C, ADR-D36): the next suggested question, the candidate conditions and the
// kept record. Nothing happens by itself: the doctor presses Asked / Dismiss / Snooze / Acknowledge / Select. The lists
// are read again only when the confirmed or rejected facts change (`refreshKey`) or after an action, never on keystrokes.
// No sockets. Without audio + AI-processing consent only the kept record is read.
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import type { CandidateList, NextQuestion, PathwayLang, PathwayRecord } from '../api/pathwayAids';
import { useAuth } from '../auth/AuthContext';

export type AidAction = 'asked' | 'dismissed' | 'snoozed' | 'acknowledged';

export function usePathwayAids(
  sessionId: string,
  options: { lang: PathwayLang; consentOk: boolean; refreshKey: string },
) {
  const { api } = useAuth();
  const { lang, consentOk, refreshKey } = options;
  const [next, setNext] = useState<NextQuestion | null>(null);
  const [candidates, setCandidates] = useState<CandidateList | null>(null);
  const [record, setRecord] = useState<PathwayRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'load' | 'save' | 'consent' | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRecord(await api.get<PathwayRecord>(`/sessions/${sessionId}/pathway-record`));
      if (!consentOk) {
        setNext(null);
        setCandidates(null);
        setError(null);
        return;
      }
      const [n, c] = await Promise.all([
        api.get<NextQuestion>(`/sessions/${sessionId}/questions/next`, { lang }),
        api.get<CandidateList>(`/sessions/${sessionId}/candidates`, { lang }),
      ]);
      setNext(n);
      setCandidates(c);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'CONSENT_REQUIRED' ? 'consent' : 'load',
      );
    } finally {
      setLoading(false);
    }
  }, [api, sessionId, lang, consentOk]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const run = useCallback(
    async (call: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      try {
        await call();
        await load();
        return true;
      } catch (caught) {
        setError(
          caught instanceof ApiError && caught.code === 'CONSENT_REQUIRED' ? 'consent' : 'save',
        );
        await load();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const act = (eventId: string, action: AidAction) =>
    run(() => api.post(`/sessions/${sessionId}/questions/${eventId}/action`, { action }));
  const select = (
    body: { pathwayId: string; version: number } | { notListed: true; text: string },
  ) => run(() => api.post(`/sessions/${sessionId}/candidates/select?lang=${lang}`, body));
  const undo = () => run(() => api.post(`/sessions/${sessionId}/candidates/select/undo`));

  return { next, candidates, record, loading, busy, error, act, select, undo, reload: load };
}
