import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export function ProgressBar({ value }: { value: number | null }) {
  return (
    <Progress
      value={value === null ? undefined : Math.round(value * 100)}
      className={cn(value === null && 'animate-pulse')}
    />
  );
}
