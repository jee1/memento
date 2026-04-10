# scripts/ 인벤토리 (저장소 정리용)

**일자**: 2026-03-03  
**목적**: [design.md](./design.md) 2단계 — npm/문서 등록·운영 필수 스크립트만 유지, 나머지 archive 후보 분류.

---

## npm에 등록된 스크립트 (유지)

| 파일명 | npm 스크립트 | 비고 |
|--------|--------------|------|
| auto-setup.js | setup, postinstall, memento-setup | 개발 환경 설정 |
| verify-bin.js | verify-bin | 빌드 산출물 검증 |
| check-and-fix-trigger.ts | db:check-trigger, db:fix-trigger | DB 트리거 |
| generate-relation-report.ts | generate-relation-report | 관계 엔진 리포트 |
| weekly-relation-validation.ts | weekly-relation-validation | 주간 관계 검증 |
| quality-thresholds.ts | quality:thresholds | 품질 임계값 |
| quality-report.ts | quality:report | 품질 리포트 |
| generate-ground-truth.ts | quality:ground-truth:generate | ground truth 생성 |
| migrate-embedding-data.js | migrate:embedding, migrate:embedding:analyze, migrate:embedding:rollback | 임베딩 마이그레이션 |
| backup-embeddings.js | backup:embeddings | 임베딩 백업 |
| regenerate-embeddings.js | regenerate:embeddings | 임베딩 재생성 |
| debug-embeddings.js | debug:embeddings | 임베딩 디버깅 |
| fix-vector-dimensions.js | fix:vector-dimensions | 벡터 차원 수정 |
| fix-tfidf-dimensions.ts | fix:tfidf-dimensions | TF-IDF 차원 수정 |
| test-docker.js | test:docker | Docker 테스트 |
| mcp-http-client.js | (없음) | 루트에서 scripts로 이동함. HTTP MCP 클라이언트 예제. 유지. |
| test-anchor-map-ui.sh | (없음) | 루트에서 scripts로 이동함. 문서에서 참조. 유지. |

---

## 문서·PRD에서 참조되는 스크립트 (유지)

| 파일명 | 참조 | 비고 |
|--------|------|------|
| backup-daily.bat | tasks/0019-prd-security-hardening.md, scripts-index.md | 운영용 백업. 미사용 시 제거 검토. |
| check-sql-injection.ts | tasks/0019, tasks-0019 | 보안 검사. 유지. |
| check-pii-masking.ts | tasks/0019, tasks-0019 | 보안 검사. 유지. |
| check-path-traversal.ts | tasks/0019, tasks-0019 | 보안 검사. 유지. |
| check-file-sizes.ts | tasks/0017, 0023 | 코드 품질. 유지. |
| count-any-types.ts | tasks/0017, 0023 | 코드 품질. 유지. |
| count-console-logs.ts | tasks/0017, 0021, 0023 | 코드 품질. 유지. |
| check-legacy-script-usage.ts | docs/guides/ko/legacy-scripts-migration-guide.md | 레거시 마이그레이션. 유지. |

---

## archive 후보 (일회성·레거시·미참조)

npm·문서에 등록되지 않았거나, scripts-index에서 "삭제 또는 archive 이동 검토"로 언급된 항목.

| 파일명 | 권장 | 비고 |
|--------|------|------|
| direct-sql-migration.sql | archive | 일회성 SQL. docs/operations에 이력 기록 후 scripts/archive/ 이동. |
| restore-legacy.ps1 | archive | Windows 복원. 미사용 시 archive. |
| restore-legacy.sh | archive | 복원 스크립트. 미사용 시 archive. |
| backup-daily.bat | 유지 또는 archive | PRD 0019 참조. 사용처 확인 후 결정. |
| analyze-benchmark-test-data.ts | archive | 분석용 일회성. |
| analyze-simple-throws.ts | archive | 분석용. |
| check-convertible-episodic-memories.ts | archive | 검증 보조. |
| check-db-integrity.js | 유지 | DB 무결성. tasks에서 참조. |
| check-embedding-dimensions.ts | archive | 검증 보조. |
| check-magic-numbers.ts | 유지 | tasks 0021 등 참조. |
| check-no-console-violations.ts | archive | 검증 보조. |
| check-retry-usage.ts | archive | 검증 보조. |
| docker-migration.sh | archive | Docker 마이그레이션 일회성. |
| find-external-api-calls.ts | 유지 | tasks 0021 참조. |
| fix-migration.js | 유지 | DB 마이그레이션. tasks 참조. |
| fix-vec-table-dimensions.ts | archive | 차원 수정 보조. |
| run-migration.js | 유지 | 마이그레이션. tasks 참조. |
| safe-migration.js | 유지 | tasks 참조. |
| simple-migrate-wrapper.ts | 유지 | 레거시 마이그레이션 가이드 참조. |
| simple-migrate.js | 유지 | 레거시 마이그레이션 가이드 참조. |
| simple-update-wrapper.ts | 유지 | 레거시 마이그레이션 가이드 참조. |
| simple-update.js | 유지 | 레거시 마이그레이션 가이드 참조. |
| start-container.sh | archive | Docker 일회성. |
| save-work-memory.ts | archive 또는 유지 | 리뷰 문서 참조. |
| remove-benchmark-test-data.ts | archive | 벤치마크 데이터 제거. |

---

## 요약

- **유지**: npm 등록 15개 + 문서/PRD 참조 다수. archive 후보만 `scripts/archive/`로 이동하고, scripts-index.md에 "이전 경로 → archive" 안내 추가.
- **archive 이동 대상 (1차)**: direct-sql-migration.sql, restore-legacy.ps1, restore-legacy.sh, analyze-benchmark-test-data.ts, analyze-simple-throws.ts, check-convertible-episodic-memories.ts, check-embedding-dimensions.ts, check-no-console-violations.ts, check-retry-usage.ts, docker-migration.sh, fix-vec-table-dimensions.ts, start-container.sh, remove-benchmark-test-data.ts (참조 없는 일회성 위주).
