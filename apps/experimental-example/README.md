# experimental-example

실험용 앱 예시. **연결 방식: 라이브러리(in-process)**.

- **의존**: `@memento/core` (MCP/HTTP 서버 없이 같은 프로세스에서 core API 사용)
- **환경**: DB 경로는 `DB_PATH` 환경 변수 또는 `createMementoCore({ dbPath })` 인자로 전달. 기본값 `:memory:` (휘발성 DB).

## 실행

```bash
# 루트에서 패키지 빌드 후
npm run build

# 앱만 빌드·실행
cd apps/experimental-example && npm run build && npm start
```

또는 루트에서:

```bash
npm run build -w @memento/core
npm run build -w experimental-example
npm run start -w experimental-example
```

실행 시 `createMementoCore`로 초기화한 뒤 `remember` → `recall`를 한 번씩 호출하는 최소 예시가 동작합니다.
