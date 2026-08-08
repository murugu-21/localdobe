import { presetConfig } from '../src/lib/pdf/compressPresets';

test('low does plain optimize only', () => {
  expect(presetConfig('low')).toEqual({ dedupResources: false, dedupContentStreams: false });
});
test('medium dedups resource dicts', () => {
  expect(presetConfig('medium')).toEqual({ dedupResources: true, dedupContentStreams: false });
});
test('high dedups everything', () => {
  expect(presetConfig('high')).toEqual({ dedupResources: true, dedupContentStreams: true });
});
