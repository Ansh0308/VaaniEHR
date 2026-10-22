// The prescription rows of one consultation (PG-08): read, add, edit, remove, apply a template. The server validates
// everything and decides what is locked; this hook only carries the doctor's choices there and shows the answer.
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import type { PrescriptionList, PrescriptionRow, RowDraft, RowPatch } from '../api/prescription';
import { useAuth } from '../auth/AuthContext';

export type PrescriptionError = 'load' | 'save' | 'signed' | 'invalid' | null;

const errorOf = (err: unknown): PrescriptionError =>
  err instanceof ApiError
    ? err.code === 'VISIT_SIGNED'
      ? 'signed'
      : err.status === 400
        ? 'invalid'
        : 'save'
    : 'save';

export function usePrescription(sessionId: string) {
  const { api } = useAuth();
  const [rows, setRows] = useState<PrescriptionRow[]>([]);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PrescriptionError>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api.get<PrescriptionList>(`/sessions/${sessionId}/prescription`);
      setRows(data.rows);
      setLocked(data.locked);
      setError(null);
    } catch {
      setError('load');
    } finally {
      setLoading(false);
    }
  }, [api, sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs one change, then reads the list again so the screen always shows what the server holds. */
  async function change(run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reload();
      return true;
    } catch (err) {
      const kind = errorOf(err);
      setError(kind);
      if (kind === 'signed') await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    rows,
    locked,
    loading,
    busy,
    error,
    reload,
    add: (draft: RowDraft) =>
      change(() => api.post(`/sessions/${sessionId}/prescription/items`, draft)),
    edit: (id: string, patch: RowPatch) =>
      change(() => api.patch(`/sessions/${sessionId}/prescription/items/${id}`, patch)),
    remove: (id: string) =>
      change(() => api.delete(`/sessions/${sessionId}/prescription/items/${id}`)),
    applyTemplate: (templateId: string) =>
      change(() => api.post(`/sessions/${sessionId}/prescription/apply-template`, { templateId })),
  };
}
