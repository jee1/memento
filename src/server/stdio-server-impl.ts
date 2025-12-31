/**
 * Stdio 서버 구현 모듈
 * 
 * index.ts의 로직을 모듈화하여 export합니다.
 * 나중에 index.ts가 이 모듈을 사용하도록 리팩토링됩니다.
 */

// 현재는 index.ts의 startServer 함수를 export하는 임시 구현
// 1.3 작업에서 index.ts가 이 모듈을 사용하도록 리팩토링됩니다.

/**
 * Stdio 서버를 시작합니다
 * @returns Promise<void> 서버가 종료될 때까지 대기하는 Promise
 */
export async function startStdioServer(): Promise<void> {
  // 임시 구현: index.ts의 startServer 함수를 호출
  // 1.3 작업에서 실제 구현으로 대체됩니다.
  const { startServer } = await import('./index.js');
  return startServer();
}

