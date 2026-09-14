import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { track } from '../../../lib/analytics';
import { downloadBytes } from '../../../lib/download';
import { REPLAY_MASK } from '../../../lib/replay';

interface Props { filename: string; bytes: Uint8Array; note?: string; mime?: string }

export function DownloadResult({ filename, bytes, note, mime = 'application/pdf' }: Props) {
  // The last funnel step: a finished result is only worth something once it is
  // actually saved. The output filename is ours, not the user's, but only its
  // extension is recorded — the stem is derived from the uploaded file's name.
  function onDownload() {
    track('result_downloaded', {
      output_bytes: bytes.length,
      output_type: filename.split('.').pop()?.toLowerCase() ?? 'unknown',
    });
    downloadBytes(filename, bytes, mime);
  }

  return (
    <Card className="border-green-200 bg-green-50 text-center dark:border-green-900 dark:bg-green-950">
      <CardContent className="p-5">
        {note && <p className="mb-3 text-sm text-green-900 dark:text-green-100">{note}</p>}
        <Button size="lg" data-testid="download-result" onClick={onDownload}>
          Download <span className={REPLAY_MASK}>{filename}</span>
        </Button>
      </CardContent>
    </Card>
  );
}
