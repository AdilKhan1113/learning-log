/**
 * Wiring the barcode scanner to the catalogue.
 *
 * The decision tree itself lives in src/services/catalog/lookupBarcode.ts with
 * injected dependencies, so it is unit-tested without a camera. This hook
 * supplies the real ones and holds the screen's state.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { type CanonicalBarcode, describeBarcodeError, parseBarcode } from '../../domain/barcode.ts';
import { foods } from '../../db/repositories/index.ts';
import {
  type BarcodeOutcome,
  resolveBarcode,
} from '../../services/catalog/lookupBarcode.ts';
import { describeLookupError, lookupProduct } from '../../services/openfoodfacts/index.ts';
import { describeFallbackError, lookupBarcode as lookupFallback } from '../../services/usda/index.ts';
import type { LookupError } from '../../services/openfoodfacts/client.ts';
import type { FallbackError } from '../../services/usda/client.ts';

/**
 * Either service's error, rendered for the screen.
 *
 * The two unions overlap on offline, timeout, http and malformed, and the
 * Open Food Facts wording reads correctly for either source. `unavailable` and
 * `signed_out` are specific to the fallback, which goes through our own Edge
 * Function and so can fail in ways a public API cannot.
 */
function describeError(error: LookupError | FallbackError): string {
  return error.code === 'unavailable' || error.code === 'signed_out'
    ? describeFallbackError(error)
    : describeLookupError(error);
}

export type ScanState =
  | { status: 'idle' }
  | { status: 'looking_up'; barcode: string }
  | { status: 'rejected'; message: string }
  | { status: 'resolved'; outcome: BarcodeOutcome };

export function useBarcodeLookup() {
  const [state, setState] = useState<ScanState>({ status: 'idle' });

  /**
   * A camera fires the same barcode many times a second. Without this the
   * screen would launch dozens of lookups for one packet.
   */
  const inFlight = useRef(false);
  const lastHandled = useRef<string | null>(null);

  const reset = useCallback(() => {
    inFlight.current = false;
    lastHandled.current = null;
    setState({ status: 'idle' });
  }, []);

  const handleScan = useCallback(async (raw: string) => {
    if (inFlight.current || lastHandled.current === raw) return;
    inFlight.current = true;
    lastHandled.current = raw;

    const parsedResult = parseBarcode(raw);
    if (!parsedResult.ok) {
      setState({ status: 'rejected', message: describeBarcodeError(parsedResult.error) });
      inFlight.current = false;
      return;
    }

    const barcode: CanonicalBarcode = parsedResult.value;
    setState({ status: 'looking_up', barcode: barcode.scanned });

    try {
      const outcome = await resolveBarcode(barcode, {
        findCached: (candidates) => foods.findByBarcode(candidates),
        lookupOff: (code) => lookupProduct(code),
        lookupFallback: (candidates) => lookupFallback(candidates),
        cache: (food, source) => foods.cacheProduct(food, source),
        describeError,
      });

      setState({ status: 'resolved', outcome });
    } catch {
      setState({
        status: 'rejected',
        message: 'Something went wrong looking that up. Try scanning again.',
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Memoised for the same reason as useMealEstimate: a fresh object each
  // render makes this hook unsafe to put in a dependency array.
  return useMemo(() => ({ state, handleScan, reset }), [state, handleScan, reset]);
}
