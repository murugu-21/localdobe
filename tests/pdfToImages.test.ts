import { DPI_PRESETS, capScaleToPixelBudget, dpiToScale, pageImageName } from '../src/lib/pdf/pdfToImages';

describe('DPI_PRESETS', () => {
  test('standard is 150, high is 300', () => {
    expect(DPI_PRESETS.standard).toBe(150);
    expect(DPI_PRESETS.high).toBe(300);
  });
});

describe('dpiToScale', () => {
  test('150 dpi -> ~2.0833 scale', () => {
    expect(dpiToScale(150)).toBeCloseTo(2.0833, 4);
  });
  test('300 dpi -> ~4.1666 scale', () => {
    expect(dpiToScale(300)).toBeCloseTo(4.1666, 3);
  });
});

describe('capScaleToPixelBudget', () => {
  test('A4 at 300 DPI is unchanged (well under the 16M-pixel budget)', () => {
    const scale = dpiToScale(DPI_PRESETS.high);
    const [widthPt, heightPt] = [595.28, 841.89];
    const capped = capScaleToPixelBudget(scale, widthPt, heightPt);
    expect(capped).toBe(scale);
    expect((widthPt * capped) * (heightPt * capped)).toBeLessThan(16_000_000);
  });

  test('a 36x48in page at 300 DPI is capped so total pixels stay within budget', () => {
    const scale = dpiToScale(DPI_PRESETS.high);
    const widthPt = 36 * 72; // 2592pt
    const heightPt = 48 * 72; // 3456pt
    // Uncapped this would be ~155M pixels, far past the 16M budget.
    expect((widthPt * scale) * (heightPt * scale)).toBeGreaterThan(16_000_000);
    const capped = capScaleToPixelBudget(scale, widthPt, heightPt);
    const total = (widthPt * capped) * (heightPt * capped);
    expect(total).toBeLessThanOrEqual(16_000_000 * 1.01);
    expect(capped).toBeLessThan(scale);
  });

  test('never increases scale', () => {
    // Tiny page, way under budget at any reasonable scale.
    const scale = dpiToScale(DPI_PRESETS.high);
    const capped = capScaleToPixelBudget(scale, 50, 50);
    expect(capped).toBe(scale);
    expect(capped).toBeLessThanOrEqual(scale);
  });

  test('respects a custom maxPixels budget', () => {
    const capped = capScaleToPixelBudget(4, 100, 100, 10_000);
    // Uncapped: (100*4)*(100*4) = 160,000; budget is 10,000 -> must shrink.
    expect(capped).toBeLessThan(4);
    expect((100 * capped) * (100 * capped)).toBeLessThanOrEqual(10_000 * 1.01);
  });
});

describe('pageImageName', () => {
  test('jpeg format uses .jpg extension, 1-based page numbering', () => {
    expect(pageImageName('document', 0, 'jpeg')).toBe('document-page-1.jpg');
    expect(pageImageName('document', 4, 'jpeg')).toBe('document-page-5.jpg');
  });
  test('png format uses .png extension, 1-based page numbering', () => {
    expect(pageImageName('document', 0, 'png')).toBe('document-page-1.png');
    expect(pageImageName('document', 9, 'png')).toBe('document-page-10.png');
  });
});
