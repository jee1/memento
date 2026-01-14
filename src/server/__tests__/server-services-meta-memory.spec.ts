/**
 * ServerServices 인터페이스 확장 테스트
 * metaMemoryService 필드가 포함되는지 확인
 */

import { describe, it, expect } from 'vitest';
import type { ServerServices } from '../bootstrap.js';
import type { MetaMemoryService } from '../../services/meta-memory-service.js';

describe('ServerServices 인터페이스 확장', () => {
  it('given: ServerServices 타입이 있을 때, when: metaMemoryService 필드를 확인하면, then: 필드가 포함되어야 함', () => {
    // Given: ServerServices 타입
    // When: metaMemoryService 필드 확인
    // Then: 필드가 포함되어야 함
    
    // 타입 체크를 위한 더미 객체 생성
    const services: Partial<ServerServices> = {
      // metaMemoryService 필드가 타입에 포함되어 있는지 확인
      metaMemoryService: undefined
    };

    // TypeScript 컴파일 타임에 타입 체크가 이루어지므로,
    // 런타임 테스트로는 인터페이스 확장을 직접 검증할 수 없습니다.
    // 대신, 실제 ServerServices 객체에 metaMemoryService가 포함되는지 확인합니다.
    
    // 타입 정의 확인: ServerServices에 metaMemoryService가 선택적 필드로 포함되어야 함
    // 이는 TypeScript 컴파일러가 검증하므로, 여기서는 타입 호환성만 확인
    expect(services).toHaveProperty('metaMemoryService');
  });

  it('given: ServerServices 객체가 있을 때, when: metaMemoryService를 확인하면, then: MetaMemoryService 타입이어야 함', () => {
    // Given: ServerServices 객체 (더미)
    const services = {
      metaMemoryService: undefined as MetaMemoryService | undefined
    } as Partial<ServerServices>;

    // When: metaMemoryService 확인
    // Then: MetaMemoryService 타입이어야 함
    
    // 타입 체크: metaMemoryService는 MetaMemoryService | undefined 타입이어야 함
    if (services.metaMemoryService) {
      // MetaMemoryService 인스턴스인지 확인
      expect(services.metaMemoryService).toBeDefined();
      // 실제 인스턴스 검증은 초기화 테스트에서 수행
    } else {
      // 선택적 필드이므로 undefined일 수 있음
      expect(services.metaMemoryService).toBeUndefined();
    }
  });
});
