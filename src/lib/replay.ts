/**
 * Session-replay privacy markers.
 *
 * Replays exist to show how the interface is used, so tool controls, options,
 * and layout stay visible; only content that comes from the visitor's document
 * is hidden. Both markers are PostHog defaults, matched by the
 * `session_recording` config in ./analytics.ts:
 *
 * - `REPLAY_MASK` — text is replaced by asterisks before the snapshot leaves
 *   the browser. The element, its layout, and the controls around it stay
 *   visible. Use it on file names, rendered document text (including
 *   contentEditable overlays), and signature details.
 * - `REPLAY_BLOCK` — the element and its subtree are replaced by a placeholder.
 *   Use it on the pixels of a user document (PDF page canvases and page/image
 *   previews) and on hidden `<input type="file">` elements, whose `.value`
 *   exposes the selected file's name.
 *
 * Never put either on a whole tool: wrapping everything (which ToolPageShell
 * used to do) hides the controls the replays exist to show.
 */

export const REPLAY_MASK = 'ph-mask';
export const REPLAY_BLOCK = 'ph-no-capture';
