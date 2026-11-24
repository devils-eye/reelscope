import { describe, expect, test } from 'bun:test';
import { countFromTileText, isPostPath, pageCode, postCodeFromHref } from './igdom';

describe('postCodeFromHref', () => {
  test('top-level post and reel links', () => {
    expect(postCodeFromHref('/p/C9xYz12AbcD/')).toBe('C9xYz12AbcD');
    expect(postCodeFromHref('/reel/C9xYz12AbcD/?igsh=abc')).toBe('C9xYz12AbcD');
    expect(postCodeFromHref('/reels/C9xYz12AbcD/')).toBe('C9xYz12AbcD');
    expect(postCodeFromHref('https://www.instagram.com/p/B_-tKyjnSR0/#x')).toBe('B_-tKyjnSR0');
  });

  test('profile-grid links carry the username first', () => {
    expect(postCodeFromHref('/fakecreator/reel/FAKE006/')).toBe('FAKE006');
    expect(postCodeFromHref('/some.user_1/p/C9xYz12AbcD/')).toBe('C9xYz12AbcD');
  });

  test('comment permalinks still give the post code', () => {
    expect(postCodeFromHref('/p/C9xYz12AbcD/comments/')).toBe('C9xYz12AbcD');
    expect(postCodeFromHref('/p/C9xYz12AbcD/c/1789/')).toBe('C9xYz12AbcD');
  });

  test('rejects non-post pages', () => {
    for (const href of [
      '/',
      '/reels/',
      '/reels/audio/123456789/',
      '/explore/',
      '/fakecreator/',
      '/fakecreator/reels/',
      '/explore/p/C9xYz12AbcD/',
      '/stories/someone/123/',
      '/p/',
      '/p/ab/',
      '',
      null,
      undefined,
      'not a url',
    ]) {
      expect(postCodeFromHref(href)).toBe(null);
    }
  });
});

describe('pageCode / isPostPath', () => {
  test('post pages and the reels viewer', () => {
    expect(pageCode('/reels/C9xYz12AbcD/')).toBe('C9xYz12AbcD');
    expect(isPostPath('/p/C9xYz12AbcD/')).toBe(true);
    expect(isPostPath('/fakecreator/')).toBe(false);
    expect(isPostPath('/')).toBe(false);
  });
});

describe('countFromTileText', () => {
  test('view counts as reels-tab tiles print them', () => {
    expect(countFromTileText('▶ 1.9M')).toBe(1_900_000);
    expect(countFromTileText('41.2K')).toBe(41_200);
    expect(countFromTileText('2.5 M')).toBe(2_500_000);
    expect(countFromTileText('1,204')).toBe(1204);
    expect(countFromTileText('312')).toBe(312);
    expect(countFromTileText('Pinned post icon 12K')).toBe(12_000);
  });

  test('no number, or one written another way, gives undefined', () => {
    expect(countFromTileText('')).toBe(undefined);
    expect(countFromTileText('Clip')).toBe(undefined);
    expect(countFromTileText('1,9 Mio.')).toBe(undefined);
    expect(countFromTileText('1.204')).toBe(undefined);
  });
});
