# feat/110-cli-for-ai TypeScript 사전 코드 리뷰

**일자**: 2026-03-12  
**대상 브랜치**: feat/110-cli-for-ai  
**범위**: CLI 진입점, env 로더, 옵션 매핑, 로거·임베딩 서비스의 CLI quiet 처리, AC5/AC6/AC9/AC10 통합 테스트

---

## 1. 리뷰 범위

| 우선순위 | 파일 | 설명 |
|----------|------|------|
| 높음 | `packages/memento-server/src/cli.ts` | CLI 진입점, stderr 래핑, core 초기화·도구 실행 |
| 높음 | `packages/memento-server/src/cli/env-loader.ts` | .env 로드, resolveEnvPath, loadEnv |
| 높음 | `packages/memento-server/src/cli/option-map.ts` | CLI 인자 → 도구 파라미터 매핑 |
| 높음 | `packages/memento-server/src/cli/cli-ac5-ac6.spec.ts` | CLI 통합 테스트 (AC5/AC6/AC9/AC10) |
| 높음 | `packages/memento-core/src/shared/utils/logger.ts` | isCliQuiet(), 로그 억제 |
| 높음 | `packages/memento-core/src/server/mcp-logger.ts` | CLI quiet 시 shouldLog 스킵 |
| 중간 | `packages/memento-core/src/domains/embedding/services/minilm-embedding-service.ts` | isCliQuiet 사용, stderr 억제, 전역 플래그 |
| 중간 | `packages/memento-core/src/domains/embedding/services/unified-embedding-service.ts` | isCliQuiet 사용 |
| 중간 | `packages/memento-core/src/domains/embedding/services/gemini-embedding-service.ts` | isCliQuiet 사용 |
| 참고 | `packages/memento-server/package.json` | bin "memento" → dist/cli.js |

---

## 2. 요약

- **강점**: stderr 래핑으로 서드파티·core 로그를 CLI에서 일관되게 억제하고, stdout=JSON·stderr=에러만 노출하도록 잘 설계됨. env 탐색 순서·옵션 매핑이 명세(REQ-CFG-2, REQ-TOOL-1)와 맞음. **AC6/AC9**, **AC10**(필수 인자 누락·알 수 없는 서브커맨드) 테스트와 env-loader JSDoc(REQ-CFG-4), forgetParams `--memory-id` 우선 주석이 반영되어 있음.
- **심각**: 없음.
- **권장**: 타입 안전성(stderr 래퍼 시그니처, subcommand non-null 제거), 전역 플래그 제거(minilm), minilm `any` 타입 축소, 테스트 스위트 빌드 미완료 시 스킵 처리.
- **참고**: package.json bin 경로, logger isCliQuiet 규칙.

---

## 3. 🤖 AI 코드 리뷰 (사전 검토)

안녕하세요! PR을 올리기 전에 코드를 함께 살펴보는 시니어 멘토입니다.  
전반적으로 **REQ-IO-4(CLI 시 로그 억제)**와 **AC5/AC8**를 만족하도록 stderr 래핑·MEMENTO_CLI_QUIET·isCliQuiet()가 일관되게 적용된 점, 그리고 **AC6/AC9·AC10** 테스트와 명세 반영 주석이 추가된 점이 인상적입니다.

공식 리뷰에 올리기 전에 몇 가지 개선하면 좋을 포인트를 정리해 봤습니다.

-----

### 🎯 주요 개선 제안

#### 🐞 잠재적 버그 및 오류

- **(발견된 문제점)**: `cli.ts`에서 `subcommand`가 `string | undefined`인데, `TOOL_SUBCOMMANDS.has(subcommand!)`에서 non-null assertion(`!`)을 사용함. 논리상 `showHelp`가 false일 때만 이 분기에 도달하고 그때는 `subcommand`가 존재하지만, 타입만으로는 보장되지 않음.
- **(이유)**: 향후 분기 순서 변경 시 런타임에 `undefined`가 들어가 `Set#has`에 전달될 수 있음. 명세 CON-4(서브커맨드 식별 시 undefined 대비)와도 부합하도록 수정 권장.
- **(제안)**:
  ```typescript
  // 수정 전 (Before)
  if (!TOOL_SUBCOMMANDS.has(subcommand!)) {
    originalStderrWrite(`Unknown command: ${subcommand}. Use --help.\n`);

  // 수정 후 (After)
  const cmd = subcommand ?? '';
  if (!TOOL_SUBCOMMANDS.has(cmd)) {
    originalStderrWrite(`Unknown command: ${cmd || '(none)'}. Use --help.\n`);
    process.exit(1);
  }
  ```

- **(참고·이미 반영)**: `env-loader.ts`의 `resolveEnvPath()` JSDoc에 “파일이 없을 때도 기본 경로(~/.memento/.env)를 반환하며, 실제 로드 여부는 loadEnv() 또는 existsSync()로 확인해야 함”(REQ-CFG-4)이 명시되어 있음. 추가 수정 불필요.

- **(참고·이미 반영)**: `option-map.ts`의 `forgetParams`에서 “`--id`와 `--memory-id` 둘 다 주어지면 `--memory-id` 우선”이 주석으로 명시되어 있음.

#### 🧹 클린 코드 (가독성 및 중복)

- **(발견된 문제점)**: `cli.ts` 상단의 `process.stderr.write` 래퍼에서 `chunk`, `encoding`, `callback`을 `unknown`으로 받고, 전달 시 `as any`로 캐스팅함.
- **(이유)**: Node.js `WriteStream.write` 시그니처와 맞추면 타입 안전성을 높일 수 있음. 명세 CON-4(타입 안전성) 권장 사항과 일치.
- **(제안)**:
  ```typescript
  // 수정 후 (After) – Node.js 타입 활용
  process.stderr.write = function (
    chunk: any,
    encoding?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean {
    if (process.env.MEMENTO_CLI_QUIET === '1') {
      if (typeof callback === 'function') callback();
      return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
  };
  ```
  (Node 타입 정의에 맞게 `BufferEncoding | ((err?: Error) => void)` 등 정확한 오버로드는 프로젝트의 @types/node 버전에 맞춰 조정.)

- **(발견된 문제점)**: `minilm-embedding-service.ts`에서 `(global as any).__minilmModelLoadWarningShown`으로 전역 플래그를 사용함. 테스트 격리나 다중 인스턴스 시 공유 상태가 됨.
- **(이유)**: 전역 오염과 테스트 간 간섭 가능성. 명세 CON-5(전역 상태 지양)와 부합하도록 모듈 스코프로 이전 권장.
- **(제안)**: 모듈 스코프의 `let minilmModelLoadWarningShown = false`로 두고, 해당 모듈 내부에서만 참조하도록 변경.

#### 🔒 타입 안정성

- **(발견된 문제점)**: `minilm-embedding-service.ts`의 `model`, `loadingPromise`, `loadModel()` 반환 타입이 `any`로 선언됨.
- **(이유)**: @xenova/transformers 파이프라인 반환 타입이 복잡할 수 있으나, `any`는 타입 체크 이점을 잃게 함.
- **(제안)**: 가능한 범위에서 `Pipeline` 또는 라이브러리가 제공하는 최소 인터페이스 타입을 지정하거나, `unknown` + 타입 가드로 좁히기.

#### 🔒 보안

- **(검토 결과)**: `env-loader.ts`에서 `--env-file`/`--config-dir`로 전달된 경로는 **사용자가 명시적으로 지정한 경로**이므로, path traversal은 “의도된 경로 지정”으로 볼 수 있음. `resolveEnvPath`는 해당 경로를 반환할 뿐, 임의 파일 내용을 읽는 API가 아님. `loadEnv()`는 dotenv로 해당 경로만 로드하므로, 민감 정보는 .env 내용 관리 정책으로 해결하는 것이 적절함.
- **(권장)**: API 키·비밀은 명세대로 CLI 인자로 받지 않고 환경변수·.env로만 제공하므로 유지. 향후 다른 글로벌 옵션에서 “경로” 인자를 추가할 때는 명세 CON-6에 따라 `path.resolve` 후 `path.relative` 또는 허용 prefix 검사로 탈출 경로를 제한하는 방안을 고려할 수 있음.

#### 📋 테스트 (AC5/AC6/AC9/AC10, 유지보수성)

- **(이미 반영)**: `cli-ac5-ac6.spec.ts`에 **AC6/AC9**(cwd에 .env 없고 ~/.memento/.env에만 DB_PATH 있을 때 해당 DB 사용) 전용 테스트와 **AC10(1)**(recall without --query → exit 1, stderr에 query/requires 포함), **AC10(2)**(알 수 없는 서브커맨드 → exit 1) 테스트가 추가되어 있음. 명세 수용 기준을 잘 충족함.

- **(개선 제안)**: `beforeAll`에서 `cliPath`가 없을 때 `console.warn`만 하고 테스트는 그대로 실행됨. 빌드가 안 된 상태에서 `runCli`가 실패할 수 있으므로, `if (!fs.existsSync(cliPath)) { ... skip / throw ... }`로 스위트 자체를 스킵하거나 실패시키는 것이 명확할 수 있음.

-----

### 📝 참고 사항 (낮은 우선순위)

- **package.json**: `bin.memento`가 `./dist/cli.js`를 가리키므로, `npm run build` 후에만 CLI 실행 가능. 문서·테스트 주석에 이미 안내되어 있음. 추가 변경 불필요.
- **logger.ts**: `isCliQuiet()`가 `process.env.MEMENTO_CLI_QUIET === '1'`만 검사하므로, “1”이 아닌 값(예: "true")은 quiet이 아님. 명세가 “CLI 모드에서 억제”로 정의해 두었다면 현재 동작으로 충분함.
- **mcp-logger.ts**: `shouldLog()`에서 `MEMENTO_CLI_QUIET === '1'`일 때 false 반환하여 CLI 시 MCP 로거도 출력하지 않음. logger.ts와 동일한 규칙으로 일관됨.

-----

### 📝 요약

몇 가지 제안 사항을 드렸지만, 코드의 핵심 로직은 잘 작성되었습니다.  
위 제안들을 검토하고 반영해 본다면 더욱 견고하고 읽기 좋은 코드가 될 것입니다.

수고하셨습니다!

-----

## 4. 결론 및 권장 사항

### 4.1 코드 품질

- **결론**: 명세(REQ-CLI-1, REQ-IO-4, REQ-CFG-2, REQ-CFG-3, REQ-CFG-4, AC5, AC8)를 잘 반영하고 있음.
- **권장**: subcommand에 대한 non-null assertion 제거, stderr 래퍼의 Node.js 타입 시그니처 정리, minilm 전역 플래그를 모듈 스코프로 이전.

### 4.2 타입 안전성

- **결론**: 대부분 타입이 명확하나, cli.ts의 `subcommand!` 및 stderr 래퍼의 `unknown`/`as any`, minilm의 `any` 사용이 남아 있음.
- **권장**: CON-4 반영을 위해 subcommand는 `?? ''` 등으로 안전하게 처리하고, stderr 래퍼는 `@types/node`의 WriteStream.write 시그니처에 맞춤. minilm은 가능한 범위에서 `Pipeline` 또는 `unknown`+가드로 축소.

### 4.3 보안

- **결론**: API 키·비밀은 CLI 인자로 받지 않으며, 경로 인자는 사용자 지정 경로로 한정되어 있음.
- **권장**: 현 구조 유지. 향후 경로 옵션 추가 시 CON-6에 따라 path.resolve·path.relative 또는 prefix 검사 검토.

### 4.4 테스트 커버리지

- **결론**: AC5, AC6/AC9, AC10(1)(2), --help(AC1)에 대한 통합 테스트가 있으며, 명세 수용 기준을 충족함.
- **권장**: 빌드 미완료 시 테스트 스위트 스킵 또는 실패 처리로 실행 결과를 명확히 함.

위 권장 사항을 반영하면 공식 리뷰에서 더 수월하게 통과할 수 있을 것입니다.
