import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Locks an async user action synchronously before React can render its pending
 * state. This closes the same-frame double-click gap while still exposing a
 * state value for disabled buttons and loading indicators.
 */
export const useAsyncActionLock = () => {
  const lockRef = useRef(false);
  const mountedRef = useRef(true);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runLocked = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (lockRef.current) return undefined;

    lockRef.current = true;
    if (mountedRef.current) setIsPending(true);

    try {
      return await action();
    } finally {
      lockRef.current = false;
      if (mountedRef.current) setIsPending(false);
    }
  }, []);

  return { isPending, runLocked };
};
