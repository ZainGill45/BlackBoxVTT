import { useCallback, useEffect, useState } from 'react';

export const DELETE_CONFIRMATION_TIMEOUT_MS = 5_000;

export function useDeleteConfirmation(
  timeout = DELETE_CONFIRMATION_TIMEOUT_MS,
) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingId) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingId(null);
    }, timeout);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pendingId, timeout]);

  const clear = useCallback(() => {
    setPendingId(null);
  }, []);

  const request = useCallback(
    (id: string) => {
      if (pendingId === id) {
        setPendingId(null);
        return true;
      }

      setPendingId(id);
      return false;
    },
    [pendingId],
  );

  return {
    clear,
    pendingId,
    request,
  } as const;
}
