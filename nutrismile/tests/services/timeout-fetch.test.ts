import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { REQUEST_TIMEOUT_MS, timeoutMessage, withTimeout } from '../../src/services/supabase/timeoutFetch.ts';

/**
 * A fetch that never settles until its signal aborts — a hung server.
 *
 * It checks `aborted` before listening, because that is what a real fetch
 * does: a signal that is already aborted rejects immediately rather than
 * waiting for an event that has been and gone.
 */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    const abort = () => reject(new Error('aborted'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort);
  });

const okFetch: typeof fetch = async () => new Response('{}', { status: 200 });

describe('request timeout', () => {
  test('a server that never answers fails instead of hanging', async () => {
    const fetchImpl = withTimeout(hangingFetch, 20);
    await assert.rejects(fetchImpl('https://example.test'), /did not respond within/);
  });

  test('the message says how long it waited, in seconds', () => {
    assert.equal(
      timeoutMessage(15_000),
      'The backup service did not respond within 15 seconds.',
    );
  });

  test('a response that arrives in time is passed straight through', async () => {
    const response = await withTimeout(okFetch, 1_000)('https://example.test');
    assert.equal(response.status, 200);
  });

  test('the timeout does not fire once a request has finished', async () => {
    // A stray timer firing after the response would abort nothing but could
    // still keep the process alive; this pins that it is cleared.
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    await withTimeout(okFetch, 60_000)('https://example.test');
    const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    assert.equal(after, before);
  });

  test("the caller's own abort is reported as an abort, not as a timeout", async () => {
    const controller = new AbortController();
    const pending = withTimeout(hangingFetch, 10_000)('https://example.test', {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, (error: Error) => {
      assert.doesNotMatch(error.message, /did not respond/);
      return true;
    });
  });

  test('a signal already aborted never reaches the network', async () => {
    let called = false;
    const spy: typeof fetch = async (...args) => {
      called = true;
      return hangingFetch(...args);
    };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      withTimeout(spy, 10_000)('https://example.test', { signal: controller.signal }),
    );
    assert.ok(called, 'fetch is still invoked, but with an already-aborted signal');
  });

  test('the default deadline is a sane one for a phone', () => {
    assert.ok(REQUEST_TIMEOUT_MS >= 5_000 && REQUEST_TIMEOUT_MS <= 30_000);
  });
});
