/**
 * MCP 프로토콜 준수를 위해 초기화 로그는 출력하지 않음
 * 로그가 stdout/stderr로 출력되면 JSON-RPC 통신을 방해할 수 있음
 */
export const log = (..._args: unknown[]) => {
  // MCP 프로토콜 준수를 위해 로그 출력 비활성화
  // 필요시 환경 변수로 제어 가능하도록 주석 처리
  // if (process.env.MCP_DIAG === 'true') {
  //   try {
  //     process.stderr.write(args.map(String).join(' ') + '\n');
  //   } catch {
  //     // stderr 쓰기 실패 시 무시
  //   }
  // }
};
