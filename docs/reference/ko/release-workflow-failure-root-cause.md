# Release 워크플로 실패 근본 원인 (2026-03-08)

## 증상

- **워크플로**: `.github/workflows/release.yml` (Release and Publish)
- **실패 단계**: `Run tests` (`npm run test`) → exit code 1
- **실패한 테스트**: 8개 파일 (전부 `packages/memento-server/src/server/` 하위)
  - bootstrap.spec.ts, meta-memory-service-initialization.spec.ts, context.spec.ts, http-server.spec.ts, mcp-logger.spec.ts, index.spec.ts, tool-context-meta-memory-injection.spec.ts, quality.routes.spec.ts

## 근본 원인

**에러 메시지**: `Failed to resolve entry for package "@memento/core". The package may have incorrect main/module/exports specified in its package.json.`

- `@memento/core`의 `package.json` 진입점이 `dist/index.js`(및 `exports`의 `dist/` 경로)로 지정되어 있음.
- Release 워크플로에서는 **테스트를 빌드보다 먼저** 실행하고 있었음: `npm ci` → `npm run test` → (이후에야) `npm run build`.
- 따라서 테스트 실행 시점에 `packages/memento-core/dist/`가 없어, Vite(Vitest)가 `@memento/core` 진입점을 찾지 못함.
- memento-server 스펙이 `@memento/core`를 import하므로, 위 8개 스펙만 진입점 해석 단계에서 실패함.

## 해결

- **조치**: Release 워크플로에서 **테스트 전에 패키지 빌드** 단계 추가.
  - `Install dependencies` 다음에 `Build packages` (`npm run build`) 실행.
  - 그 다음 `Run tests` 실행.
- **결과**: `@memento/core`(및 server, client)가 먼저 빌드되므로, 테스트 시 `dist/`가 존재하고 진입점 해석이 성공함.

## 참고

- CI 워크플로(ci.yml)는 이미 lint/typecheck 후 테스트 job들이 돌기 전에 별도로 빌드하지 않지만, **테스트 job별로** `test:ci:root`, `test:ci:core`, `test:ci:server` 등으로 나뉘어 있어 server 테스트 시에는 루트에서 한 번에 `vitest`를 돌리지 않음. 반면 Release는 루트에서 `npm run test` 한 번으로 전체를 돌리므로, 이 경우 빌드 선행이 필요함.
