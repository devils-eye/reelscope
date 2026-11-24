import { expect, test } from 'bun:test';
import { followersWord, isLongVideo, platformOf, profileUrl, siteName } from './platform';

test('platform words and links', () => {
  expect(platformOf('youtube')).toBe('youtube');
  expect(platformOf(undefined)).toBe('instagram');
  expect(siteName('youtube')).toBe('YouTube');
  expect(siteName(null)).toBe('Instagram');
  expect(followersWord('youtube')).toBe('subscribers');
  expect(followersWord('instagram')).toBe('followers');
  expect(profileUrl('instagram', 'fakecreator')).toBe('https://www.instagram.com/fakecreator/');
  expect(profileUrl('youtube', 'jawed')).toBe('https://www.youtube.com/@jawed');
  expect(profileUrl('youtube', 'UC4QobU6STFB0P71PMvOGN5A')).toBe('https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A');
});

test('isLongVideo: a YouTube /watch link, not a Short or a reel', () => {
  expect(isLongVideo({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' })).toBe(true);
  expect(isLongVideo({ platform: 'youtube', url: 'https://www.youtube.com/shorts/abcdefghijk' })).toBe(false);
  expect(isLongVideo({ platform: 'instagram', url: 'https://www.instagram.com/reel/C9xYz12AbcD/' })).toBe(false);
});
