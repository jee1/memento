/**
 * 캐시 서비스 인터페이스 (DIP)
 * 도메인은 이 인터페이스만 참조하고, 인프라 구현체를 주입받음.
 */

export interface ICacheService<T = unknown> {
  get(key: string): T | null;
  set(key: string, data: T, ttl?: number): void;
  delete(key: string): void;
  keys(): string[];
}
