/**
 * ServerState 클래스 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerState } from './server-state.js';

describe('ServerState', () => {
  let serverState: ServerState;

  beforeEach(() => {
    serverState = ServerState.getInstance();
    serverState.reset();
  });

  afterEach(() => {
    serverState.reset();
  });

  it('getInstance()는 항상 동일한 인스턴스를 반환해야 함', () => {
    expect(ServerState.getInstance()).toBe(ServerState.getInstance());
  });

  it('전송 연결 여부는 처음에 false 이고 설정한 값을 돌려준다', () => {
    expect(serverState.isMcpTransportConnected()).toBe(false);
    serverState.setMcpTransportConnected(true);
    expect(serverState.isMcpTransportConnected()).toBe(true);
    serverState.setMcpTransportConnected(false);
    expect(serverState.isMcpTransportConnected()).toBe(false);
  });

  it('reset()은 전송 연결 여부를 false 로 되돌린다', () => {
    serverState.setMcpTransportConnected(true);
    serverState.reset();
    expect(serverState.isMcpTransportConnected()).toBe(false);
  });
});
