import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { UNLOCK_PDF_HINT, UNLOCK_PDF_HREF } from '../../../lib/toolLinks';

interface Props {
  message: string;
  /** Optional prefix (e.g. a masked file name) rendered before the message. */
  prefix?: ReactNode;
  className?: string;
}

/**
 * Renders a tool failure.
 *
 * Messages that recommend unlocking a password-protected PDF carry the
 * `UNLOCK_PDF_HINT` marker (see src/lib/toolLinks.ts). The marker is replaced
 * with a real link to the Unlock tool, so the advice is actionable in every
 * tool — never a dead path left in text. Messages without the marker render
 * unchanged.
 */
export function ToolError({ message, prefix, className }: Props) {
  const parts = message.split(UNLOCK_PDF_HINT);
  return (
    <p role="alert" className={cn('text-sm text-destructive', className)}>
      {prefix}
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <a href={UNLOCK_PDF_HREF} className="font-medium underline underline-offset-2">
              the Unlock PDF tool
            </a>
          )}
          {part}
        </Fragment>
      ))}
    </p>
  );
}
