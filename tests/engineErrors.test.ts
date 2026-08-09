import { friendlyEngineError } from '../src/lib/pdf/engineErrors';

const PW = 'optimize: prepare PDF context: read context: encryption setup: please provide the correct password';

test('encrypted input on non-unlock tools points at the Unlock tool', () => {
  expect(friendlyEngineError('optimize', PW)).toMatch(/password-protected.*Unlock/i);
  expect(friendlyEngineError('watermark', PW.replace('optimize', 'add watermarks'))).toMatch(/Unlock/);
});

test('wrong password on unlock stays a password message', () => {
  expect(friendlyEngineError('decrypt', 'decrypt: ... encryption setup: please provide the correct password'))
    .toMatch(/password didn’t work/i);
});

test('unlocking an unencrypted file is called out as such', () => {
  expect(friendlyEngineError('decrypt', 'decrypt: prepare PDF context: read context: encryption status: this file is not encrypted'))
    .toMatch(/isn’t password-protected/i);
});

test('encrypting an already-encrypted file explains itself', () => {
  expect(friendlyEngineError('encrypt', 'encrypt: prepare PDF context: read context: encryption status: this file is encrypted'))
    .toMatch(/already password-protected/i);
});

test('no removable watermarks reads like a sentence, not a stack trace', () => {
  const msg = friendlyEngineError('watermark', 'remove watermarks: apply: locate optional content groups: no watermarks found');
  expect(msg).toMatch(/No removable watermarks/i);
  expect(msg).not.toMatch(/optional content groups/);
});

test('corrupt-file engine errors become a plain damaged-file message', () => {
  expect(friendlyEngineError('optimize', 'optimize: write output: write PDF: objects: missing page node dict type'))
    .toMatch(/valid PDF|damaged/i);
  expect(friendlyEngineError('watermark', 'add watermarks: apply: page 1: page dictionary: page not found'))
    .toMatch(/valid PDF|damaged/i);
});

test('validateSignatures "no signatures present" sentinel passes through untouched', () => {
  const raw = 'validate signatures: no signatures present';
  expect(friendlyEngineError('validateSignatures', raw)).toBe(raw);
});

test('unknown errors fall back to a generic message', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(friendlyEngineError('optimize', 'weird new failure mode')).toMatch(/Something went wrong/i);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
