import { presetConfig } from '../src/lib/pdf/compressPresets';

const lossless = { downsampleImages: false, imageDpi: 0, jpegQuality: 0 };

test('low does plain optimize only', () => {
  expect(presetConfig('low')).toEqual({ dedupResources: false, dedupContentStreams: false, ...lossless });
});
test('medium dedups resource dicts', () => {
  expect(presetConfig('medium')).toEqual({ dedupResources: true, dedupContentStreams: false, ...lossless });
});
test('high dedups everything', () => {
  expect(presetConfig('high')).toEqual({ dedupResources: true, dedupContentStreams: true, ...lossless });
});
test('images dedups everything and downsamples to 150 dpi / q75', () => {
  expect(presetConfig('images')).toEqual({
    dedupResources: true,
    dedupContentStreams: true,
    downsampleImages: true,
    imageDpi: 150,
    jpegQuality: 75,
  });
});
