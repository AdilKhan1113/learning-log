import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDigit,
  describeBarcodeError,
  hasValidChecksum,
  lookupCandidates,
  parseBarcode,
  toEan13,
  upcEToUpcA,
} from '../../src/domain/barcode.ts';

describe('check digits', () => {
  test('computes the EAN-13 check digit', () => {
    // 5000112637922 — a real Coca-Cola EAN-13; payload checks to 2.
    assert.equal(checkDigit('500011263792'), 2);
  });

  test('computes the UPC-A check digit', () => {
    // 036000291452 — the canonical GS1 example.
    assert.equal(checkDigit('03600029145'), 2);
  });

  test('computes the EAN-8 check digit', () => {
    assert.equal(checkDigit('9638507'), 4);
  });

  test('validates a complete code', () => {
    assert.ok(hasValidChecksum('5000112637922'));
    assert.ok(hasValidChecksum('036000291452'));
    assert.ok(hasValidChecksum('96385074'));
  });

  test('rejects a code with one digit misread', () => {
    assert.ok(!hasValidChecksum('5000112637921'));
    assert.ok(!hasValidChecksum('036000291453'));
  });

  test('a check digit is always a single digit', () => {
    // The (10 - sum % 10) % 10 form must yield 0, not 10, when sum is a multiple of 10.
    assert.equal(checkDigit('00000000000'), 0);
    assert.ok(checkDigit('99999999999') < 10);
  });
});

describe('UPC-E expansion', () => {
  // Cases cover each of the four expansion rules the last digit selects.
  test('last digit 0-2 moves two digits and inserts four zeroes', () => {
    assert.equal(upcEToUpcA('04252614'), '042100005264');
  });

  test('last digit 3 inserts five zeroes after three digits', () => {
    assert.equal(upcEToUpcA('01234534'), '012300000454');
  });

  test('last digit 4 inserts five zeroes after four digits', () => {
    assert.equal(upcEToUpcA('01234544'), '012340000054');
  });

  test('last digit 5-9 inserts four zeroes and keeps the last digit', () => {
    assert.equal(upcEToUpcA('01234565'), '012345000065');
  });

  test('an expanded code is a valid UPC-A length', () => {
    for (const upcE of ['04252614', '01234534', '01234544', '01234565']) {
      assert.equal(upcEToUpcA(upcE)!.length, 12, upcE);
    }
  });

  test('a number system other than 0 or 1 is not a UPC-E', () => {
    assert.equal(upcEToUpcA('54252614'), null);
  });

  test('the wrong length is not a UPC-E', () => {
    assert.equal(upcEToUpcA('0425261'), null);
  });
});

describe('EAN-13 form', () => {
  test('a UPC-A is padded to 13 digits', () => {
    assert.equal(toEan13('036000291452'), '0036000291452');
  });

  test('an EAN-13 is left alone', () => {
    assert.equal(toEan13('5000112637922'), '5000112637922');
  });
});

describe('parsing a scan', () => {
  test('an EAN-13 parses to itself', () => {
    const result = parseBarcode('5000112637922');
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.canonical, '5000112637922');
    assert.equal(result.value.format, 'ean_13');
  });

  test('a UPC-A is converted to EAN-13 for lookup', () => {
    const result = parseBarcode('036000291452');
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.format, 'upc_a');
    assert.equal(
      result.value.canonical,
      '0036000291452',
      'a US product looked up as 12 digits would never be found',
    );
    assert.equal(result.value.scanned, '036000291452', 'the scan itself is kept');
  });

  test('an EAN-8 keeps its own namespace rather than being padded', () => {
    const result = parseBarcode('96385074');
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.format, 'ean_8');
    assert.equal(result.value.canonical, '96385074');
  });

  test('surrounding whitespace is tolerated', () => {
    assert.ok(parseBarcode('  5000112637922 \n').ok);
  });

  test('a misread code is rejected rather than looked up', () => {
    const result = parseBarcode('5000112637921');
    assert.ok(!result.ok && result.error.code === 'bad_checksum');
  });

  test('the checksum can be waived for a hand-typed code', () => {
    const result = parseBarcode('5000112637921', { verifyChecksum: false });
    assert.ok(result.ok);
  });

  test('a QR code or other non-numeric payload is refused', () => {
    const result = parseBarcode('https://example.com');
    assert.ok(!result.ok && result.error.code === 'not_numeric');
  });

  test('a length that is not a symbology is refused', () => {
    const result = parseBarcode('12345');
    assert.ok(!result.ok && result.error.code === 'bad_length');
  });

  test('an empty read is refused', () => {
    assert.ok(!parseBarcode('   ').ok);
  });
});

describe('lookup candidates', () => {
  test('a UPC-A is tried padded and unpadded', () => {
    const parsed = parseBarcode('036000291452');
    assert.ok(parsed.ok);
    if (!parsed.ok) return;

    const candidates = lookupCandidates(parsed.value);
    assert.equal(candidates[0], '0036000291452', 'the canonical form is tried first');
    assert.ok(
      candidates.includes('036000291452'),
      'catalogues are inconsistent about padding, so both are tried',
    );
  });

  test('an EAN-13 needs only one attempt', () => {
    const parsed = parseBarcode('5000112637922');
    assert.ok(parsed.ok);
    if (parsed.ok) assert.deepEqual(lookupCandidates(parsed.value), ['5000112637922']);
  });

  test('candidates are never duplicated', () => {
    for (const code of ['5000112637922', '036000291452', '96385074']) {
      const parsed = parseBarcode(code);
      assert.ok(parsed.ok);
      if (!parsed.ok) continue;
      const candidates = lookupCandidates(parsed.value);
      assert.equal(new Set(candidates).size, candidates.length, code);
    }
  });
});

describe('failure messages', () => {
  test('every failure has a message', () => {
    const errors = [
      { code: 'empty' as const },
      { code: 'not_numeric' as const, value: 'x' },
      { code: 'bad_length' as const, length: 5 },
      { code: 'bad_checksum' as const, value: '1' },
    ];
    for (const error of errors) {
      assert.ok(describeBarcodeError(error).length > 0, error.code);
    }
  });

  test('a bad read suggests what to do, without blaming the user', () => {
    const message = describeBarcodeError({ code: 'bad_checksum', value: '1' });
    assert.ok(/light|steadier/i.test(message));
    assert.ok(!/you failed|invalid|error/i.test(message));
  });
});
