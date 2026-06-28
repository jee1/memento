# Implementation Plan: 029-http-client-dedup

## Architecture

Node.js ≥24 baseline을 활용해 루트 레벨 HTTP 호출은 **native `fetch`** 로 통일한다. 패키지 레벨 `@memento/client`는 axios 기반 인터셉터·타입을 유지한다.

## Changes

| 파일 | 변경 |
|------|------|
| `package.json` | `axios`, `node-fetch` 제거 |
| `package-lock.json` | `npm install` 재생성 |
| `scripts/mcp-http-client.js` | `node-fetch` import 제거, global fetch 사용 |
| `scripts/test-docker.js` | `axios` → native fetch |
| `packages/memento-core/src/test/test-memory-neighbors.ts` | `node-fetch` import 제거 |
| `docs/agents/architecture.md` | `@memento/core` pin 정책 섹션 추가 |

## Test Strategy

- `npm run build && npm test && npm run lint && npm run type-check`
- grep으로 루트 direct import 잔존 확인

## Constitution Alignment

- Structural deps cleanup: 기존 CI green baseline이 회귀 신호 (Constitution I exception)
- Quality gates (Constitution IV) 필수
