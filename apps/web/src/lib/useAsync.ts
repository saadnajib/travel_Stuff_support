import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Runs `fn` on mount and whenever `deps` change. Ignores results from stale calls.
 * Pass `enabled=false` to skip loading (e.g. waiting for auth).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const callId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++callId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === callId.current) setDataState(result);
    } catch (e) {
      if (id === callId.current) setError(e);
    } finally {
      if (id === callId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      void run();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: T | undefined) => T)(prev) : updater,
    );
  }, []);

  return { data, error, loading, reload: run, setData };
}
