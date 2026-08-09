import { expiryReplayTimes, mergeExpiryReplay } from '../src/lib/pdf/signingTimeAssessment';

const SIGNED_AT = '2025-11-14T21:30:29Z';
const SIGNED_MS = new Date(SIGNED_AT).valueOf();

function entry(reason: number, signingTime: string | undefined = SIGNED_AT) {
  return { Reason: reason, Details: { SigningTime: signingTime } };
}

test('collects signing times only for entries with the expiry bit (256)', () => {
  expect(expiryReplayTimes([entry(256)])).toEqual([SIGNED_MS]);
  expect(expiryReplayTimes([entry(256 | 4096)])).toEqual([SIGNED_MS]);
  expect(expiryReplayTimes([entry(4096), entry(128)])).toEqual([]);
});

test('ignores missing, unparseable, and Go-zero signing times', () => {
  expect(expiryReplayTimes([{ Reason: 256, Details: {} }])).toEqual([]);
  expect(expiryReplayTimes([{ Reason: 256 }])).toEqual([]);
  expect(expiryReplayTimes([entry(256, 'not a date')])).toEqual([]);
  expect(expiryReplayTimes([entry(256, '0001-01-01T00:00:00Z')])).toEqual([]);
});

test('merge replaces an entry when the replay cleared the expiry bit', () => {
  const first = [entry(256)];
  const replay = [entry(4096)];
  expect(mergeExpiryReplay(first, replay, SIGNED_MS)).toBe(1);
  expect(first[0].Reason).toBe(4096);
  expect((first[0] as Record<string, unknown>).__assessedAtSigningTime).toBe(true);
});

test('merge keeps the original when the replay is STILL expired at signing time', () => {
  const first = [entry(256)];
  expect(mergeExpiryReplay(first, [entry(256)], SIGNED_MS)).toBe(0);
  expect(first[0].Reason).toBe(256);
  expect((first[0] as Record<string, unknown>).__assessedAtSigningTime).toBeUndefined();
});

test('merge only touches entries matching the replayed signing time', () => {
  const other = entry(256, '2024-01-01T00:00:00Z');
  const first = [entry(256), other];
  const replay = [entry(4096), entry(4096, '2024-01-01T00:00:00Z')];
  expect(mergeExpiryReplay(first, replay, SIGNED_MS)).toBe(1);
  expect(first[0].Reason).toBe(4096);
  expect(first[1]).toBe(other); // different signing time — untouched by this pass
});

test('merge never replaces entries that had no expiry problem', () => {
  const first = [entry(4096)];
  expect(mergeExpiryReplay(first, [entry(2)], SIGNED_MS)).toBe(0);
  expect(first[0].Reason).toBe(4096);
});
