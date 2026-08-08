import { zipSync } from 'fflate';

export function zipFiles(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  return zipSync(Object.fromEntries(entries.map((e) => [e.name, e.data])));
}
