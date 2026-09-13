import { track } from './analytics';

/**
 * Shown when the browser can't read a file the user selected. Deliberately not
 * the "corrupt or password-protected" copy: the file never reached an engine,
 * so blaming the document would be wrong.
 */
export const FILE_READ_ERROR =
  'Could not read that file. If it is stored in the cloud (iCloud Drive, OneDrive, Google Drive), download it to your device and try again. Otherwise it may have been moved or deleted since you selected it.';

/**
 * Reads a selected file into bytes, turning a read failure into `null`.
 *
 * `file.arrayBuffer()` rejects with `NotReadableError`/`NotFoundError`/
 * `SecurityError` when the browser loses access to a file after it was picked:
 * a cloud placeholder that was never downloaded, a file moved or deleted in the
 * meantime, or an expired document-picker grant (common on iOS and Android).
 * Those rejections are not the engine's fault, and thrown from a React event
 * handler they become unhandled rejections that error tracking records as
 * crashes — so they are caught here, recorded as a handled failure, and
 * reported as `null`. Callers must show `FILE_READ_ERROR` and stop.
 */
export async function readFileBytes(file: File): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
    track('tool_failed', { message, reason: 'read_failed', input_bytes: file.size });
    return null;
  }
}
