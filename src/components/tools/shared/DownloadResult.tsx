import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { downloadBytes } from '../../../lib/download';

interface Props { filename: string; bytes: Uint8Array; note?: string; mime?: string }

export function DownloadResult({ filename, bytes, note, mime = 'application/pdf' }: Props) {
  return (
    <Card className="border-green-200 bg-green-50 text-center dark:border-green-900 dark:bg-green-950">
      <CardContent className="p-5">
        {note && <p className="mb-3 text-sm text-green-900 dark:text-green-100">{note}</p>}
        <Button size="lg" data-testid="download-result" onClick={() => downloadBytes(filename, bytes, mime)}>
          Download {filename}
        </Button>
      </CardContent>
    </Card>
  );
}
