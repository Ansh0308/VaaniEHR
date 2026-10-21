// Concept suggestions for the facts of one consultation (remaining Phase 5 items, ADR-D37). One read gives up to three
// suggestions per fact; they are read again only when the set of facts, their words, or a link changes (`key`). Confirm
// and Clear are the doctor's buttons: the only way a link is ever set or removed. After either, `onLinkChanged` lets the
// page read the facts (and, through them, the pathway panels) again. No sockets.
import { useCallback, useEffect, useState } from 'react';
import type { ConceptSuggestions } from '../api/concepts';
import { useAuth } from '../auth/AuthContext';
import type { PathwayLang } from '../api/pathwayAids';

export function useConceptSuggestions(
  sessionId: string,
  options: {
    lang: PathwayLang;
    consentOk: boolean;
    key: string;
    onLinkChanged: () => Promise<unknown> | void;
  },
) {
  const { api } = useAuth();
  const { lang, consentOk, key, onLinkChanged } = options;
  const [data, setData] = useState<ConceptSuggestions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const load = useCallback(async () => {
    if (!consentOk) {
      setData(null);
      return;
    }
    try {
      setData(
        await api.get<ConceptSuggestions>(`/sessions/${sessionId}/concept-suggestions`, { lang }),
      );
      setError(null);
    } catch {
      setError('load');
    }
  }, [api, sessionId, lang, consentOk]);

  useEffect(() => {
    void load();
  }, [load, key]);

  const run = useCallback(
    async (call: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      try {
        await call();
        await onLinkChanged();
        await load();
        setError(null);
        return true;
      } catch {
        setError('save');
        await onLinkChanged();
        await load();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, onLinkChanged],
  );

  const confirm = (factId: string, conceptId: string) =>
    run(() => api.post(`/sessions/${sessionId}/facts/${factId}/concept`, { conceptId }));
  const clear = (factId: string) =>
    run(() => api.delete(`/sessions/${sessionId}/facts/${factId}/concept`));

  return { data, busy, error, confirm, clear };
}
