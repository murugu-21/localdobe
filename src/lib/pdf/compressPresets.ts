export type CompressPreset = 'low' | 'medium' | 'high';

export function presetConfig(preset: CompressPreset): { dedupResources: boolean; dedupContentStreams: boolean } {
  return {
    dedupResources: preset !== 'low',
    dedupContentStreams: preset === 'high',
  };
}
