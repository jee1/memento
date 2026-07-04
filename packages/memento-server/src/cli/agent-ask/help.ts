export function agentAskHelpText(): string {
  return (
    'memento agent ask — 개인 지식 Agent 한 턴 (in-process)\n\n' +
    'Usage: memento [global-options] agent ask <message> [options]\n\n' +
    '  <message>   ask 바로 다음에 오는 한 덩어리 문자열(필수)\n\n' +
    'Options:\n' +
    '  --project-id <id>     project_id 전달\n' +
    '  --token-budget <n>    memory_injection 추정 예산\n' +
    '  --json                stdout에 JSON 한 줄 (--json 단독 시 저장 생략)\n' +
    '  --no-save             승인·저장 단계 생략\n' +
    '  --llm mock            환경 변수 LLM provider를 무시하고 mock만 사용\n\n' +
    'LLM provider(선택): 환경 변수 MEMENTO_PERSONAL_AGENT_LLM_PROVIDER(mock|openai|gemini|ollama).\n' +
    '  미설정 시 mock. Ollama: MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL 필수, URL은 MEMENTO_PERSONAL_AGENT_OLLAMA_URL(기본 http://127.0.0.1:11434).\n\n' +
    'Global options: --config-dir, --db-path (in-process DB 경로), --env-file\n'
  );
}

