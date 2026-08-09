import { buildTextWatermarkDesc, buildImageWatermarkDesc } from '../src/lib/pdf/watermarkDesc';

test('text desc includes size, opacity, rotation, color', () => {
  expect(buildTextWatermarkDesc({ opacity: 0.4, rotation: 45, fontSize: 48, colorHex: '#808080' }))
    .toBe('points:48, op:0.4, rot:45, fillc:#808080');
});

test('image desc includes opacity, rotation, relative scale', () => {
  expect(buildImageWatermarkDesc({ opacity: 0.7, rotation: 0, scale: 0.5 }))
    .toBe('op:0.7, rot:0, scale:0.5 rel');
});

test('unsupportedWatermarkChars: ascii and WinAnsi accents pass', async () => {
  const { unsupportedWatermarkChars } = await import('../src/lib/pdf/watermarkDesc');
  expect(unsupportedWatermarkChars('CONFIDENTIAL')).toEqual([]);
  expect(unsupportedWatermarkChars('BROUILLON — déjà vu Ää €99 “quoted”')).toEqual([]);
});

test('unsupportedWatermarkChars: CJK and emoji are flagged', async () => {
  const { unsupportedWatermarkChars } = await import('../src/lib/pdf/watermarkDesc');
  expect(unsupportedWatermarkChars('机密文件')).toEqual(['机', '密', '文', '件']);
  expect(unsupportedWatermarkChars('DRAFT 🔒')).toEqual(['🔒']);
});
