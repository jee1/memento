/**
 * #1599: override set/revert 직후 키별 재적용 훅. 구현은 bootstrap 에서 register 한다.
 */
const handlers = new Map<string, () => void>();

export function registerSettingRuntimeReapply(key: string, handler: () => void): void {
  handlers.set(key, handler);
}

export function clearSettingRuntimeReapplyForTest(): void {
  handlers.clear();
}

export function unregisterSettingRuntimeReapply(key: string): void {
  handlers.delete(key);
}

export function runSettingRuntimeReapply(key: string): void {
  handlers.get(key)?.();
}
