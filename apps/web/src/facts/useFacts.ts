// Facts of one consultation (Phase 5B, ADR-D33). No sockets: every action is followed by a fresh read of the list.
// "Extract facts" is only ever started by the doctor's click: the page asks api-node for the same short-lived consent
// token the audio stream uses (refused without audio + AI-processing consent), then calls the speech service with it.
// Transcript text and facts go only to the API and the speech service, never to a log, a URL or browser storage.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { config } from '../config';

export const FACT_TYPES = [
  'symptom',
  'duration',
  'severity',
  'vital',
  'allergy',
  'past_condition',
  'current_medicine',
  'red_flag_mention',
] as const;
export type FactType = (typeof FACT_TYPES)[number];
export type FactStatusValue = 'heard' | 'confirmed' | 'rejected' | 'stale';

export interface Fact {
  id: string;
  type: FactType;
  value: string;
  negated: boolean;
  uncertain: boolean;
  speaker: 'unknown' | 'doctor' | 'patient' | null;
  source: 'extracted' | 'manual';
  sourceSegmentSeq: number | null;
  spanStart: number | null;
  spanEnd: number | null;
  evidenceQuote: string | null;
  status: FactStatusValue;
  edited: boolean;
  originalValue: string | null;
  conceptId: string | null;
}

interface FactList {
  facts: Fact[];
  heardCount: number;
  confirmedCount: number;
  rejectedCount: number;
  staleCount: number;
}

export type ExtractMode = 'sample' | 'live' | 'blocked';
export type ExtractErrorCode =
  | 'cap_reached'
  | 'rate_limited'
  | 'model_unavailable'
  | 'real_data_blocked'
  | 'consent'
  | 'not_configured'
  | 'network'
  | 'other';

export interface FactEditBody {
  value: string;
  negated: boolean;
  uncertain: boolean;
}

const KNOWN: ExtractErrorCode[] = [
  'cap_reached',
  'rate_limited',
  'model_unavailable',
  'real_data_blocked',
  'not_configured',
];

export function useFacts(sessionId: string) {
  const { api } = useAuth();
  const [list, setList] = useState<FactList | null>(null);
  const [mode, setMode] = useState<ExtractMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<ExtractErrorCode | 'save' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef<Set<string> | null>(null);

  const reload = useCallback(async (): Promise<Fact[]> => {
    try {
      const data = await api.get<FactList>(`/sessions/${sessionId}/facts`);
      setList(data);
      return data.facts;
    } catch {
      return [];
    }
  }, [api, sessionId]);

  useEffect(() => {
    void reload().then((facts) => {
      seen.current = new Set(facts.map((f) => f.id));
    });
    fetch(`${config.asrHttpUrl}/extraction/mode`)
      .then((r) => r.json())
      .then((body: { data?: { mode?: ExtractMode } }) => setMode(body.data?.mode ?? null))
      .catch(() => setMode(null));
  }, [reload]);

  const act = useCallback(
    async (run: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await run();
        seen.current = new Set((await reload()).map((f) => f.id));
        return true;
      } catch (caught) {
        setError(caught instanceof ApiError && caught.status === 403 ? 'consent' : 'save');
        seen.current = new Set((await reload()).map((f) => f.id));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const confirm = (id: string) =>
    act(() => api.patch(`/sessions/${sessionId}/facts/${id}`, { action: 'confirm' }));
  const reject = (id: string) =>
    act(() => api.patch(`/sessions/${sessionId}/facts/${id}`, { action: 'reject' }));
  const edit = (id: string, body: FactEditBody) =>
    act(() => api.patch(`/sessions/${sessionId}/facts/${id}`, { action: 'edit', ...body }));
  const add = (body: { type: FactType; value: string; negated: boolean; uncertain: boolean }) =>
    act(() => api.post(`/sessions/${sessionId}/facts`, body));

  const extract = useCallback(async (): Promise<void> => {
    setExtracting(true);
    setError(null);
    try {
      const { token } = await api.post<{ token: string }>(`/sessions/${sessionId}/asr-token`);
      const response = await fetch(`${config.asrHttpUrl}/sessions/${sessionId}/extract`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      if (!response.ok) {
        const code = body?.error?.code ?? '';
        setError(
          KNOWN.includes(code as ExtractErrorCode)
            ? (code as ExtractErrorCode)
            : response.status === 403 || response.status === 401
              ? 'consent'
              : 'other',
        );
      }
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 403 ? 'consent' : 'network');
    } finally {
      const facts = await reload();
      const before = seen.current ?? new Set<string>();
      const fresh = facts.filter((f) => !before.has(f.id));
      seen.current = new Set(facts.map((f) => f.id));
      setAnnouncement(fresh.length > 0 ? `${fresh.length}` : '');
      setExtracting(false);
    }
  }, [api, sessionId, reload]);

  return {
    facts: list?.facts ?? [],
    counts: list
      ? {
          heard: list.heardCount,
          confirmed: list.confirmedCount,
          rejected: list.rejectedCount,
          stale: list.staleCount,
        }
      : null,
    mode,
    busy,
    extracting,
    error,
    announcement,
    reload,
    confirm,
    reject,
    edit,
    add,
    extract,
  };
}
