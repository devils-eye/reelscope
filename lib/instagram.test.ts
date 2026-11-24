import { describe, expect, test } from 'bun:test';
import { itemUploadTime, mediaIdToShortcode, shortcodeFromUrl, shortcodeToMediaId, uploadTimeFromMediaId, uploadTimeFromShortcode } from './instagram';

describe('shortcodeToMediaId', () => {
  test('decodes B_-tKyjnSR0 to a numeric string, deterministically', () => {
    const first = shortcodeToMediaId('B_-tKyjnSR0');
    const second = shortcodeToMediaId('B_-tKyjnSR0');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9]+$/);
  });

  test('handles - and _ characters distinctly', () => {
    const withDash = shortcodeToMediaId('AAAAAAAAAA-');
    const withUnderscore = shortcodeToMediaId('AAAAAAAAAA_');
    const withA = shortcodeToMediaId('AAAAAAAAAAA');
    expect(withDash).toMatch(/^[0-9]+$/);
    expect(withUnderscore).toMatch(/^[0-9]+$/);
    expect(withDash === withUnderscore).toBe(false);
    expect(withDash === withA).toBe(false);
  });

  test('round-trips through mediaIdToShortcode', () => {
    // Note: a leading 'A' encodes to value 0, so it is insignificant and
    // does not survive the round-trip (same as Instagram's own encoding).
    for (const sc of ['B_-tKyjnSR0', 'BCabc019-_', 'C']) {
      expect(mediaIdToShortcode(shortcodeToMediaId(sc))).toBe(sc);
    }
    expect(shortcodeToMediaId('ABCabc019-_')).toBe(shortcodeToMediaId('BCabc019-_'));
  });
});

describe('shortcodeFromUrl', () => {
  test('handles /reel/, /reels/ and /p/ paths', () => {
    expect(shortcodeFromUrl('https://www.instagram.com/reel/B_-tKyjnSR0/')).toBe('B_-tKyjnSR0');
    expect(shortcodeFromUrl('https://www.instagram.com/reels/ABC123/?x=1')).toBe('ABC123');
    expect(shortcodeFromUrl('https://www.instagram.com/p/xyz_9/?hl=en')).toBe('xyz_9');
    expect(shortcodeFromUrl('https://www.instagram.com/explore/')).toBe(null);
  });
});

describe('upload time from the media id', () => {
  // Known reels: yt-dlp upload timestamps vs what the shortcode decodes to.
  test('decodes within a couple of minutes of taken_at', () => {
    const cases: Array<[string, number]> = [
      ['Ddbl5eBNpiQ', 1789739826],
      ['Decg1Q-Opbw', 1791918180],
    ];
    for (const [code, ts] of cases) {
      const ms = uploadTimeFromShortcode(code, ts * 1000 + 86_400_000)!;
      expect(Math.abs(ms / 1000 - ts) < 180).toBe(true);
    }
  });

  test('pk with a user suffix, and implausible ids', () => {
    const id = shortcodeToMediaId('Decg1Q-Opbw');
    expect(uploadTimeFromMediaId(`${id}_123`, Date.UTC(2026, 11, 1))).toBe(uploadTimeFromMediaId(id, Date.UTC(2026, 11, 1)));
    expect(uploadTimeFromShortcode('FAKE013')).toBe(undefined); // decodes to 2011: not a real id
    expect(uploadTimeFromMediaId('not a number')).toBe(undefined);
    expect(uploadTimeFromMediaId('0')).toBe(undefined);
  });

  test('itemUploadTime: taken_at first, then pk, then code', () => {
    const now = Date.UTC(2026, 11, 1);
    expect(itemUploadTime({ taken_at: 1_700_000_000, code: 'Decg1Q-Opbw' }, now)).toBe(1_700_000_000_000);
    const fromCode = itemUploadTime({ code: 'Decg1Q-Opbw' }, now)!;
    expect(Math.abs(fromCode / 1000 - 1791918180) < 180).toBe(true);
    expect(itemUploadTime({ pk: shortcodeToMediaId('Ddbl5eBNpiQ'), code: 'FAKE013' }, now)! > 0).toBe(true);
    expect(itemUploadTime({ code: 'FAKE013' }, now)).toBe(undefined);
  });
});
