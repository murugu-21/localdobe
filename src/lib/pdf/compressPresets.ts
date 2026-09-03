export type CompressPreset = 'low' | 'medium' | 'high' | 'images';

export interface CompressConfig {
  dedupResources: boolean;
  dedupContentStreams: boolean;
  /** Lossy: resample over-resolved images to `imageDpi` and re-encode (JPEG q=`jpegQuality` for photos). */
  downsampleImages: boolean;
  imageDpi: number;
  jpegQuality: number;
}

// Mirrors Ghostscript's /ebook preset: 150 dpi colour/gray, only resample when the
// image is >1.5× over target (threshold lives in Go), JPEG quality 75.
export const IMAGE_TARGET_DPI = 150;
export const IMAGE_JPEG_QUALITY = 75;

export function presetConfig(preset: CompressPreset): CompressConfig {
  const lossy = preset === 'images';
  return {
    dedupResources: preset !== 'low',
    dedupContentStreams: preset === 'high' || lossy,
    downsampleImages: lossy,
    imageDpi: lossy ? IMAGE_TARGET_DPI : 0,
    jpegQuality: lossy ? IMAGE_JPEG_QUALITY : 0,
  };
}
