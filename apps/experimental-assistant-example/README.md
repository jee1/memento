# experimental-assistant-example

`@jee1/memento-assistant` SDK를 사용하는 최소 echo bot 예제.

LLM 호출 없이 `stdin → SDK → stdout` 흐름만으로 SDK API가 실제로 동작하는지 확인할 수 있습니다.

## 실행

```bash
# 루트에서 실행
npx tsx apps/experimental-assistant-example/src/index.ts
```

## 환경 변수

기본값으로 stdio transport를 사용합니다 (Memento MCP 서버 자동 시작).

HTTP 서버에 연결하려면:

```bash
MEMENTO_TRANSPORT=http MEMENTO_URL=http://localhost:9001 npx tsx apps/experimental-assistant-example/src/index.ts
```

## 동작

1. 사용자 입력 수신
2. `beforeUserTurn` — 관련 기억 회상 (있으면 출력)
3. echo 응답 출력
4. `afterAssistantTurn` — 대화를 working 메모리로 저장
5. `exit` 입력 시 종료
