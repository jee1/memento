# scripts/ 스크립트 인덱스

루트 `scripts/` 디렉터리의 주요 스크립트와 실행 방법입니다. npm 스크립트로 실행하는 것이 권장됩니다.

## npm으로 실행하는 스크립트

| 스크립트 | 용도 | 실행 방법 |
|----------|------|-----------|
| auto-setup.js | 개발 환경 자동 설정 | `npm run setup` 또는 `npm run postinstall` |
| verify-bin.js | 빌드 산출물·바이너리 검증 | `npm run verify-bin` |
| check-and-fix-trigger.ts | DB 트리거 상태 확인/수정 | `npm run db:check-trigger`, `npm run db:fix-trigger` |
| check-migration-status | 마이그레이션 상태 확인 | `npm run db:check-migration` (구현: `packages/memento-server/src/scripts`) |
| generate-relation-report.ts | 관계 엔진 리포트 생성 | `npm run generate-relation-report` |
| weekly-relation-validation.ts | 관계 검증 (주간) | `npm run weekly-relation-validation` |
| quality-thresholds.ts | 품질 임계값 | `npm run quality:thresholds` |
| quality-report.ts | 품질 리포트 | `npm run quality:report` |
| generate-ground-truth.ts | ground truth 생성 | `npm run quality:ground-truth:generate` |
| compare-weight-profiles.ts | 랭킹 프로파일 A/B 비교 (MRR·NDCG·permutation test) | `npm run quality:benchmark:compare-profiles` |
| tune-weights.ts | 랭킹 가중치 자동 튜닝 (후보 생성·평가·게이트) | `npm run quality:benchmark:tune-weights` |
| tune-report.ts | 튜닝 run 결과 리포트 출력 | `npm run quality:benchmark:tune-report` |
| migrate-embedding-data.js | 임베딩 데이터 마이그레이션 | `npm run migrate:embedding`, `migrate:embedding:analyze`, `migrate:embedding:rollback` |
| backup-embeddings.js | 임베딩 백업 | `npm run backup:embeddings` |
| regenerate-embeddings.js | 임베딩 재생성 | `npm run regenerate:embeddings` |
| debug-embeddings.js | 임베딩 디버깅 | `npm run debug:embeddings` |
| fix-vector-dimensions.js | 벡터 차원 수정 | `npm run fix:vector-dimensions` |
| fix-tfidf-dimensions.ts | TF-IDF 차원 수정 | `npm run fix:tfidf-dimensions` |

## 직접 실행 가능한 스크립트 (검증·분석)

다음은 주로 품질·검증·마이그레이션 보조용이며, 필요 시 `tsx scripts/<파일명>` 또는 `node scripts/<파일명>`으로 실행합니다.

| 유형 | 예시 | 비고 |
|------|------|------|
| 검증 | check-db-integrity.js, check-embedding-dimensions.ts, check-sql-injection.ts, check-magic-numbers.ts, count-console-logs.ts 등 | CI 또는 수동 품질 검사 |
| 마이그레이션/레거시 | run-migration.js, fix-migration.js, safe-migration.js, migrate-embedding-data.js | DB/임베딩 마이그레이션 |
| 문서·리포트 생성 | generate-relation-report.ts, generate-file-audit-table.cjs, update-file-audit-doc.cjs | 문서·감사 테이블 생성 |
| 백업/복원 | backup-daily.bat, restore-legacy.ps1, restore-legacy.sh | 운영용. backup-daily.bat는 PRD 0019 등에서 참조. 미사용 시 제거 검토. |
| direct-sql-migration.sql | 일회성 SQL 마이그레이션 | → `scripts/archive/`로 이동됨 (2026-03-03). |

## scripts/archive/ (보관용)

다음 스크립트는 일회성·검증 보조용으로 `scripts/archive/`로 이동되어 있습니다. 이전 경로가 필요하면 여기서 확인하세요.

| 이전 경로 | 비고 |
|-----------|------|
| scripts/direct-sql-migration.sql | 일회성 SQL |
| scripts/restore-legacy.ps1, scripts/restore-legacy.sh | 레거시 복원 |
| scripts/analyze-benchmark-test-data.ts, scripts/analyze-simple-throws.ts | 분석용 |
| scripts/check-convertible-episodic-memories.ts, scripts/check-embedding-dimensions.ts | 검증 보조 |
| scripts/check-no-console-violations.ts, scripts/check-retry-usage.ts | 검증 보조 |
| scripts/docker-migration.sh, scripts/start-container.sh | Docker 일회성 |
| scripts/fix-vec-table-dimensions.ts, scripts/remove-benchmark-test-data.ts | 보조 |

인벤토리: [docs/_work/plans/ko/2026-03-03-scripts-inventory.md](../../_work/plans/ko/2026-03-03-scripts-inventory.md)

전체 목록은 `scripts/` 디렉터리를 참고하고, `package.json`의 `scripts` 필드에 등록된 항목을 우선 사용하세요.
