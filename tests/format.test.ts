import { formatBytes, percentSaved } from '../src/lib/format';

test('formatBytes', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(1536)).toBe('1.5 KB');
  expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
});

test('percentSaved rounds and never returns negative-looking noise', () => {
  expect(percentSaved(1000, 400)).toBe(60);
  expect(percentSaved(1000, 1000)).toBe(0);
  expect(percentSaved(1000, 1100)).toBe(-10);
});
