export function startInterval(callback: () => void, intervalMs: number): NodeJS.Timeout {
  return setInterval(callback, intervalMs);
}
