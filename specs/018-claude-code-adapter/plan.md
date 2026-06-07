# Implementation Plan: Claude Code Adapter

## Architecture

1. 순수 adapter가 원본 payload를 공통 envelope로 변환한다.
2. scope 모듈이 env → git → cwd 순서로 범위를 탐지한다.
3. settings 모듈이 immutable plan과 파일 적용을 분리한다.
4. runner가 normalize, capture, drain을 감싸고 모든 실패를 격리한다.
5. server CLI가 `connect claude-code`와 내부 `hook claude-code`를 dispatch한다.

## Test Strategy

- 기존 lifecycle 5종 fixture replay를 RED로 실행한다.
- scope, settings idempotency/backup, diagnostics, non-throwing runner를 단위 테스트한다.
- CLI는 temp settings path 주입으로 실제 홈 변경 없이 검증한다.
- GREEN 후 package test, lint, type-check, 전체 test, security scripts, graphify를 실행한다.

## Compatibility

- 신규 export만 추가한다.
- schema, DB, 기존 MCP/assistant API는 변경하지 않는다.
- 신규 dependency를 추가하지 않는다.
