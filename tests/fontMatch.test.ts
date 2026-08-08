import { classifyFont } from '../src/lib/pdf/edit/fontMatch';

test.each([
  ['Helvetica', 'sans'],
  ['ABCDEF+Arial-BoldMT', 'sans'],
  ['Times-Roman', 'serif'],
  ['ABCDEF+TimesNewRomanPSMT', 'serif'],
  ['Georgia', 'serif'],
  ['Courier', 'mono'],
  ['ABCDEF+ConsolasRegular', 'mono'],
  ['SomeUnknownFont', 'sans'],
  ['g_d0_f1', 'sans'],
] as const)('classifyFont(%s) -> %s', (name, expected) => {
  expect(classifyFont(name)).toBe(expected);
});
