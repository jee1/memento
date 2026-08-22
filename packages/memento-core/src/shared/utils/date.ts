export const DAY_MS = 86_400_000;

export function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / DAY_MS;
}
