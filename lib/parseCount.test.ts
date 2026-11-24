import { expect, test } from 'bun:test';
import { parseCount } from './instagram';

test('parseCount reads abbreviated and exact counts', () => {
  expect(parseCount('131K')).toBe(131000);
  expect(parseCount('1.2M')).toBe(1200000);
  expect(parseCount('4,512')).toBe(4512);
  expect(parseCount('131,071')).toBe(131071);
  expect(parseCount('96')).toBe(96);
  expect(parseCount('followers')).toBe(undefined);
});
