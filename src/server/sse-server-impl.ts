/**
 * SSE 서버 구현 모듈
 * 
 * http-server.ts의 로직을 모듈화하여 export합니다.
 * 나중에 http-server.ts가 이 모듈을 사용하도록 리팩토링됩니다.
 */

// 현재는 http-server.ts의 startServer, cleanup 함수를 export하는 임시 구현
// 1.4 작업에서 http-server.ts가 이 모듈을 사용하도록 리팩토링됩니다.

/**
 * SSE 서버를 시작합니다
 * @returns Promise<void> 서버 시작 완료 시 resolve
 */
export async function startSseServer(): Promise<void> {
  // 임시 구현: http-server.ts의 startServer 함수를 호출
  // 1.4 작업에서 실제 구현으로 대체됩니다.
  const { startServer } = await import('./http-server.js');
  return startServer();
}

/**
 * SSE 서버를 중지합니다
 * @returns Promise<void> 서버 중지 완료 시 resolve
 */
export async function stopSseServer(): Promise<void> {
  // 임시 구현: http-server.ts의 cleanup 함수를 호출
  // 1.4 작업에서 실제 구현으로 대체됩니다.
  const { cleanup } = await import('./http-server.js');
  return cleanup();
}

/**
 * SSE 서버 리소스를 정리합니다
 * @returns Promise<void> 정리 완료 시 resolve
 */
export async function cleanupSseServer(): Promise<void> {
  // 임시 구현: http-server.ts의 cleanup 함수를 호출
  // 1.4 작업에서 실제 구현으로 대체됩니다.
  const { cleanup } = await import('./http-server.js');
  return cleanup();
}

