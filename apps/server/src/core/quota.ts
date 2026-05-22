export function quotaExceeded(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}
