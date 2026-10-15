import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './client';

export type RequestState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiError };

/**
 * Runs an async loader when the component mounts or `deps` change (shows "loading"); reload() runs it again but KEEPS
 * showing the previous data meanwhile, so a refresh after saving does not blank the page or lose keyboard focus.
 * Answers that arrive late for an older request are ignored.
 */
export function useRequest<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' });
  const run = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const execute = useCallback((keepPrevious: boolean) => {
    const mine = ++run.current;
    setState((previous) =>
      keepPrevious && previous.status === 'ready' ? previous : { status: 'loading' },
    );
    loader
      .current()
      .then((data) => {
        if (mine === run.current) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (mine !== run.current) return;
        setState({
          status: 'error',
          error: err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Unexpected error'),
        });
      });
  }, []);

  useEffect(() => {
    execute(false);
  }, deps);
  const reload = useCallback(() => execute(true), [execute]);
  return { state, reload };
}
