/**
 * ServerState 클래스 테스트
 * 
 * Given/When/Then 구조를 따르는 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerState } from './server-state.js';

describe('ServerState', () => {
  let serverState: ServerState;

  beforeEach(() => {
    // Given: 각 테스트 전에 ServerState 인스턴스를 가져옴
    serverState = ServerState.getInstance();
    // 테스트 격리를 위해 상태 초기화
    serverState.reset();
  });

  afterEach(() => {
    // 테스트 후 상태 초기화
    serverState.reset();
  });

  /**
   * Given: ServerState 클래스가 존재함
   * When: getInstance()를 여러 번 호출
   * Then: 동일한 싱글톤 인스턴스가 반환되어야 함
   */
  describe('싱글톤 패턴', () => {
    it('getInstance()는 항상 동일한 인스턴스를 반환해야 함', () => {
      // Given: ServerState 클래스가 존재함
      // When: getInstance()를 여러 번 호출
      const instance1 = ServerState.getInstance();
      const instance2 = ServerState.getInstance();
      const instance3 = ServerState.getInstance();

      // Then: 동일한 인스턴스가 반환되어야 함
      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
      expect(instance1).toBe(instance3);
    });
  });

  /**
   * Given: ServerState 인스턴스가 초기화됨
   * When: 초기 상태를 확인
   * Then: 모든 상태가 false여야 함
   */
  describe('초기 상태', () => {
    it('초기 상태는 모든 플래그가 false여야 함', () => {
      // Given: ServerState 인스턴스가 초기화됨
      // When: 초기 상태를 확인
      // Then: 모든 상태가 false여야 함
      expect(serverState.isMcpServerInitialized()).toBe(false);
      expect(serverState.isConsoleErrorOverridden()).toBe(false);
      expect(serverState.isConsoleOverridden()).toBe(false);
      expect(serverState.isMcpTransportConnected()).toBe(false);
    });
  });

  /**
   * Given: ServerState 인스턴스가 초기화됨
   * When: mcpServerInitialized 상태를 설정하고 조회
   * Then: 설정한 값이 반환되어야 함
   */
  describe('mcpServerInitialized 상태 관리', () => {
    it('setMcpServerInitialized(true) 후 isMcpServerInitialized()는 true를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화됨
      // When: mcpServerInitialized를 true로 설정
      serverState.setMcpServerInitialized(true);

      // Then: isMcpServerInitialized()는 true를 반환해야 함
      expect(serverState.isMcpServerInitialized()).toBe(true);
    });

    it('setMcpServerInitialized(false) 후 isMcpServerInitialized()는 false를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화되고 true로 설정됨
      serverState.setMcpServerInitialized(true);

      // When: mcpServerInitialized를 false로 설정
      serverState.setMcpServerInitialized(false);

      // Then: isMcpServerInitialized()는 false를 반환해야 함
      expect(serverState.isMcpServerInitialized()).toBe(false);
    });
  });

  /**
   * Given: ServerState 인스턴스가 초기화됨
   * When: consoleErrorOverridden 상태를 설정하고 조회
   * Then: 설정한 값이 반환되어야 함
   */
  describe('consoleErrorOverridden 상태 관리', () => {
    it('setConsoleErrorOverridden(true) 후 isConsoleErrorOverridden()는 true를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화됨
      // When: consoleErrorOverridden를 true로 설정
      serverState.setConsoleErrorOverridden(true);

      // Then: isConsoleErrorOverridden()는 true를 반환해야 함
      expect(serverState.isConsoleErrorOverridden()).toBe(true);
    });

    it('setConsoleErrorOverridden(false) 후 isConsoleErrorOverridden()는 false를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화되고 true로 설정됨
      serverState.setConsoleErrorOverridden(true);

      // When: consoleErrorOverridden를 false로 설정
      serverState.setConsoleErrorOverridden(false);

      // Then: isConsoleErrorOverridden()는 false를 반환해야 함
      expect(serverState.isConsoleErrorOverridden()).toBe(false);
    });
  });

  /**
   * Given: ServerState 인스턴스가 초기화됨
   * When: consoleOverridden 상태를 설정하고 조회
   * Then: 설정한 값이 반환되어야 함
   */
  describe('consoleOverridden 상태 관리', () => {
    it('setConsoleOverridden(true) 후 isConsoleOverridden()는 true를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화됨
      // When: consoleOverridden를 true로 설정
      serverState.setConsoleOverridden(true);

      // Then: isConsoleOverridden()는 true를 반환해야 함
      expect(serverState.isConsoleOverridden()).toBe(true);
    });

    it('setConsoleOverridden(false) 후 isConsoleOverridden()는 false를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화되고 true로 설정됨
      serverState.setConsoleOverridden(true);

      // When: consoleOverridden를 false로 설정
      serverState.setConsoleOverridden(false);

      // Then: isConsoleOverridden()는 false를 반환해야 함
      expect(serverState.isConsoleOverridden()).toBe(false);
    });
  });

  /**
   * Given: ServerState 인스턴스가 초기화됨
   * When: mcpTransportConnected 상태를 설정하고 조회
   * Then: 설정한 값이 반환되어야 함
   */
  describe('mcpTransportConnected 상태 관리', () => {
    it('setMcpTransportConnected(true) 후 isMcpTransportConnected()는 true를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화됨
      // When: mcpTransportConnected를 true로 설정
      serverState.setMcpTransportConnected(true);

      // Then: isMcpTransportConnected()는 true를 반환해야 함
      expect(serverState.isMcpTransportConnected()).toBe(true);
    });

    it('setMcpTransportConnected(false) 후 isMcpTransportConnected()는 false를 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화되고 true로 설정됨
      serverState.setMcpTransportConnected(true);

      // When: mcpTransportConnected를 false로 설정
      serverState.setMcpTransportConnected(false);

      // Then: isMcpTransportConnected()는 false를 반환해야 함
      expect(serverState.isMcpTransportConnected()).toBe(false);
    });
  });

  /**
   * Given: ServerState 인스턴스가 초기화되고 모든 상태가 설정됨
   * When: reset() 메서드를 호출
   * Then: 모든 상태가 false로 초기화되어야 함
   */
  describe('reset() 메서드', () => {
    it('reset()은 모든 상태를 false로 초기화해야 함', () => {
      // Given: ServerState 인스턴스가 초기화되고 모든 상태가 설정됨
      serverState.setMcpServerInitialized(true);
      serverState.setConsoleErrorOverridden(true);
      serverState.setConsoleOverridden(true);
      serverState.setMcpTransportConnected(true);

      // When: reset() 메서드를 호출
      serverState.reset();

      // Then: 모든 상태가 false로 초기화되어야 함
      expect(serverState.isMcpServerInitialized()).toBe(false);
      expect(serverState.isConsoleErrorOverridden()).toBe(false);
      expect(serverState.isConsoleOverridden()).toBe(false);
      expect(serverState.isMcpTransportConnected()).toBe(false);
    });
  });

  /**
   * Given: ServerState 싱글톤 인스턴스가 존재함
   * When: resetInstance()를 호출한 후 getInstance()를 호출
   * Then: 새로운 인스턴스가 생성되어야 함
   */
  describe('resetInstance() 메서드', () => {
    it('resetInstance()는 싱글톤 인스턴스를 리셋해야 함', () => {
      // Given: ServerState 싱글톤 인스턴스가 존재하고 상태가 설정됨
      const instance1 = ServerState.getInstance();
      instance1.setMcpServerInitialized(true);
      instance1.setMcpTransportConnected(true);

      // When: resetInstance()를 호출
      ServerState.resetInstance();

      // Then: 새로운 인스턴스가 생성되어야 함
      const instance2 = ServerState.getInstance();
      expect(instance2).not.toBe(instance1);
      expect(instance2.isMcpServerInitialized()).toBe(false);
      expect(instance2.isMcpTransportConnected()).toBe(false);
    });
  });

  /**
   * Given: ServerState 인스턴스가 초기화되고 상태가 설정됨
   * When: getSnapshot()을 호출하여 스냅샷을 저장하고 상태를 변경한 후 restoreSnapshot()으로 복원
   * Then: 원래 상태로 복원되어야 함
   */
  describe('스냅샷 및 복원 기능', () => {
    it('getSnapshot()과 restoreSnapshot()으로 상태를 저장하고 복원할 수 있어야 함', () => {
      // Given: ServerState 인스턴스가 초기화되고 상태가 설정됨
      serverState.setMcpServerInitialized(true);
      serverState.setConsoleErrorOverridden(true);
      serverState.setConsoleOverridden(false);
      serverState.setMcpTransportConnected(true);

      // When: 스냅샷을 저장
      const snapshot = serverState.getSnapshot();

      // 상태를 변경
      serverState.setMcpServerInitialized(false);
      serverState.setConsoleErrorOverridden(false);
      serverState.setConsoleOverridden(true);
      serverState.setMcpTransportConnected(false);

      // 스냅샷으로 복원
      serverState.restoreSnapshot(snapshot);

      // Then: 원래 상태로 복원되어야 함
      expect(serverState.isMcpServerInitialized()).toBe(true);
      expect(serverState.isConsoleErrorOverridden()).toBe(true);
      expect(serverState.isConsoleOverridden()).toBe(false);
      expect(serverState.isMcpTransportConnected()).toBe(true);
    });

    it('getSnapshot()은 현재 상태의 정확한 복사본을 반환해야 함', () => {
      // Given: ServerState 인스턴스가 초기화되고 상태가 설정됨
      serverState.setMcpServerInitialized(true);
      serverState.setConsoleErrorOverridden(false);
      serverState.setConsoleOverridden(true);
      serverState.setMcpTransportConnected(false);

      // When: 스냅샷을 가져옴
      const snapshot = serverState.getSnapshot();

      // Then: 스냅샷이 현재 상태와 일치해야 함
      expect(snapshot.mcpServerInitialized).toBe(true);
      expect(snapshot.consoleErrorOverridden).toBe(false);
      expect(snapshot.consoleOverridden).toBe(true);
      expect(snapshot.mcpTransportConnected).toBe(false);
    });
  });
});
