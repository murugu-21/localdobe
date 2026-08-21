import { DPI_PRESETS, dpiToScale, pageImageName } from '../src/lib/pdf/pdfToImages';

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
