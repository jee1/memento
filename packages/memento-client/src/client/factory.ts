import { MementoClient } from '../memento-client.js';
import type { MementoClientOptions } from '../types.js';

/**
 * MementoClient 인스턴스를 생성하는 팩토리 함수
 */
export function createMementoClient(options?: MementoClientOptions): MementoClient {
  return new MementoClient(options);
}
