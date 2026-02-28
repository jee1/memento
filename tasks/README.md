# tasks/ 디렉터리

PRD(제품/기능 요구사항)와 그에 따른 태스크 브레이크다운 문서가 저장되는 곳입니다.

## 파일 명명 규칙

| 패턴 | 용도 |
|------|------|
| `000N-prd-*.md` | **PRD 본문**. 요구사항, 목표, 사용자 스토리, 비기능 요구사항 등 제품/기능 명세. |
| `tasks-000N-prd-*.md` | **태스크 브레이크다운**. 해당 PRD를 실행하기 위한 구체적 작업 목록, 관련 파일, 단계. |

같은 번호 N에 대해 `000N-prd-*.md`가 명세이고, `tasks-000N-prd-*.md`가 그에 대응하는 작업 목록입니다. 파일마다 역할이 다르므로 새 PRD·태스크를 추가할 때 위 규칙을 따르면 됩니다.

## 기타 파일

- `create-prd.md`, `generate-tasks.md`, `process-task-list.md` — PRD/태스크 생성·처리 메타 가이드
- `db-connection-refactoring-verification.md` 등 — 특정 주제별 검증·정리 문서
