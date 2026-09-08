/**
 * Barcode normalisation and validation.
 *
 * A scanner hands back whatever is printed on the packet, and the same product
 * can be a 12-digit UPC-A in the US, an 8-digit UPC-E on a small packet, and a
 * 13-digit EAN-13 in Europe. Open Food Facts keys products by their EAN-13
 * form, so a scan has to be converted before it is looked up or a US product
 * will never be found.
 *
 * Pure, and therefore all of it is tested.
 */
import { type Result, err, ok } from './result.ts';

export type BarcodeFormat = 'ean_8' | 'upc_e' | 'upc_a' | 'ean_13' | 'itf_14';

export type BarcodeError =
  | { code: 'empty' }
  | { code: 'not_numeric'; value: string }
  | { code: 'bad_length'; length: number }
  | { code: 'bad_checksum'; value: string };

export interface CanonicalBarcode {
  /** The form to look up: EAN-13 wherever a conversion exists. */
  canonical: string;
  /** Exactly what the scanner read, kept for display and for a second attempt. */
  scanned: string;
  format: BarcodeFormat;
}

/** Lengths that correspond to a real symbology. */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

function formatFor(length: number, digits: string): BarcodeFormat {
  switch (length) {
    case 8:
      // A UPC-E always starts with a 0 or 1 number system; anything else of
      // this length is an EAN-8.
      return digits[0] === '0' || digits[0] === '1' ? 'upc_e' : 'ean_8';
    case 12:
      return 'upc_a';
    case 14:
      return 'itf_14';
    default:
      return 'ean_13';
  }
}

/**
 * The GS1 check digit for a code given without one.
 *
 * Digits are weighted 3 and 1 alternately from the right, which is the same
 * rule for EAN-8, UPC-A, EAN-13 and ITF-14 — only the length differs.
 */
export function checkDigit(payload: string): number {
  let sum = 0;
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(payload[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** Whether a complete code's last digit matches its payload. */
export function hasValidChecksum(code: string): boolean {
  if (code.length < 2) return false;
  const payload = code.slice(0, -1);
  return checkDigit(payload) === Number(code[code.length - 1]);
}

/**
 * Expand a UPC-E to its full UPC-A.
 *
 * UPC-E compresses a UPC-A that contains a run of zeroes, and the last digit
 * of the six-digit body says where those zeroes were. Without this expansion a
 * small packet — gum, a single yoghurt — never matches anything.
 */
export function upcEToUpcA(upcE: string): string | null {
  if (upcE.length !== 8) return null;

  const numberSystem = upcE[0]!;
  if (numberSystem !== '0' && numberSystem !== '1') return null;

  const body = upcE.slice(1, 7);
  const check = upcE[7]!;
  const [d1, d2, d3, d4, d5, d6] = body.split('') as [
    string, string, string, string, string, string,
  ];

  let manufacturerAndProduct: string;
  switch (d6) {
    case '0':
    case '1':
    case '2':
      manufacturerAndProduct = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
      break;
    case '3':
      manufacturerAndProduct = `${d1}${d2}${d3}00000${d4}${d5}`;
      break;
    case '4':
      manufacturerAndProduct = `${d1}${d2}${d3}${d4}00000${d5}`;
      break;
    default:
      manufacturerAndProduct = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
      break;
  }

  return `${numberSystem}${manufacturerAndProduct}${check}`;
}

/** Left-pad to 13 digits, which is how a UPC-A is expressed as an EAN-13. */
export function toEan13(code: string): string {
  return code.length >= 13 ? code : code.padStart(13, '0');
}

export interface ParseOptions {
  /**
   * Reject a code whose check digit does not match. On by default: a misread
   * barcode that happens to be the right length would otherwise be looked up
   * as a real product and quietly return someone else's food.
   */
  verifyChecksum?: boolean;
}

/**
 * Turn a raw scan into the form to look up.
 *
 * The checksum is the reason to do this rather than pass the string straight
 * through: cameras misread, and a single wrong digit in a valid-looking code
 * would fetch a different product entirely.
 */
export function parseBarcode(
  raw: string,
  options: ParseOptions = {},
): Result<CanonicalBarcode, BarcodeError> {
  const { verifyChecksum = true } = options;

  const trimmed = raw.trim();
  if (trimmed === '') return err({ code: 'empty' });
  if (!/^\d+$/.test(trimmed)) return err({ code: 'not_numeric', value: trimmed });
  if (!VALID_LENGTHS.has(trimmed.length)) {
    return err({ code: 'bad_length', length: trimmed.length });
  }
  if (verifyChecksum && !hasValidChecksum(trimmed)) {
    return err({ code: 'bad_checksum', value: trimmed });
  }

  const format = formatFor(trimmed.length, trimmed);
  const expanded = format === 'upc_e' ? (upcEToUpcA(trimmed) ?? trimmed) : trimmed;

  return ok({
    // EAN-8 is its own namespace and is not zero-padded into EAN-13 space.
    canonical: format === 'ean_8' ? trimmed : toEan13(expanded),
    scanned: trimmed,
    format,
  });
}

/**
 * The forms worth trying against a catalogue, most likely first.
 *
 * Databases are inconsistent about whether a US product is stored as its
 * 12-digit UPC or its zero-padded EAN-13, so both are tried before concluding
 * that a product is absent.
 */
export function lookupCandidates(barcode: CanonicalBarcode): string[] {
  const candidates = [barcode.canonical];

  if (barcode.scanned !== barcode.canonical) candidates.push(barcode.scanned);

  // The expanded UPC-A of a UPC-E, unpadded.
  if (barcode.format === 'upc_e') {
    const expanded = upcEToUpcA(barcode.scanned);
    if (expanded && !candidates.includes(expanded)) candidates.push(expanded);
  }

  // A zero-padded EAN-13 may also be stored in its 12-digit form.
  if (barcode.canonical.length === 13 && barcode.canonical.startsWith('0')) {
    const unpadded = barcode.canonical.slice(1);
    if (!candidates.includes(unpadded)) candidates.push(unpadded);
  }

  return candidates;
}

/** What to tell the user when a scan cannot be used. Never blames them. */
export function describeBarcodeError(error: BarcodeError): string {
  switch (error.code) {
    case 'empty':
      return 'Nothing was read from that scan.';
    case 'not_numeric':
      return "That code isn't a product barcode.";
    case 'bad_length':
      return `That code is ${error.length} digits, which isn't a product barcode length.`;
    case 'bad_checksum':
      return "That barcode didn't read cleanly. Try holding steadier or moving into better light.";
  }
}
