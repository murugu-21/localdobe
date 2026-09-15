/**
 * Canonical links referenced from tool copy and error messages.
 *
 * Internal links always use the trailing-slash form (see SEO-STRATEGY.md), and
 * message text uses the same shared constants so a path can never drift out of
 * sync with the page it points at.
 */

export const UNLOCK_PDF_HREF = '/unlock-pdf/';

/**
 * In-app marker meaning "this problem is fixed by the Unlock tool".
 *
 * Error messages carry this token exactly where the recommendation belongs.
 * `ToolError` (src/components/tools/shared/ToolError.tsx) swaps it for a real
 * link, so the advice is actionable in every tool instead of a dead text path.
 * The message itself must stay readable if the token is stripped — analytics
 * records it, and the FAQ copies are not the only consumers.
 */
export const UNLOCK_PDF_HINT = '(/unlock-pdf)';
