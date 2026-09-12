/**
 * A fetch that gives up.
 *
 * supabase-js has no request timeout, so a server that accepts a connection
 * and then never answers leaves the promise pending for as long as the OS
 * allows — which on a phone can be minutes. The sync store sets its status to
 * 'syncing' before awaiting and clears it after, so a request that never
 * settles leaves the Profile screen saying "Backing up…" forever, with no
 * error, no retry, and nothing to tell the user what happened.
 *
 * Wrapping fetch rather than passing a signal per call means auth, PostgREST
 * and the Edge Function calls are all covered by one rule, including the ones
 * supabase-js makes on its own.
 *
 * Its own module, with fetch injected, because that is what makes the timeout
 * testable without a network or a fake clock.
 */

/** Long enough for a slow mobile connection, short enough to still be a UI. */
export const REQUEST_TIMEOUT_MS = 15_000;

export function timeoutMessage(timeoutMs: number): string {
  return `The backup service did not respond within ${Math.round(timeoutMs / 1000)} seconds.`;
}

/**
 * @param fetchImpl injected in tests; defaults to the global fetch
 * @param timeoutMs how long to wait before giving up on a single request
 */
export function withTimeout(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();

    // A caller's own abort still has to work — the timeout is an additional
    // reason to stop, not a replacement for the existing one.
    const callerSignal = init?.signal ?? undefined;
    if (callerSignal?.aborted) controller.abort();
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      // Distinguish our own deadline from the caller's cancellation. Both
      // surface as an AbortError, and only one of them is worth reporting as
      // a failed backup — so the flag decides, not the error.
      if (timedOut) throw new Error(timeoutMessage(timeoutMs));
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}
