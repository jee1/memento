# scripts/ 스크립트 인덱스

루트 `scripts/`에는 DB 백업·마이그레이션, 검색 품질 벤치, 임베딩 복구 같은 **운영·품질 작업**이 모여 있습니다. 대부분은 `package.json`에 등록된 npm 스크립트로 호출하는 것이 안전합니다. 이름만 보고 직접 `node scripts/...`를 실행하기 전에, 이 표에서 용도와 권장 명령을 확인하세요.

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
| compare-weight-profiles.ts | 랭킹 프로파일 A/B 비교 (MRR·NDCG·permutation test) | `npm run quality -- benchmark compare-profiles` |
| tune-weights.ts | 랭킹 가중치 자동 튜닝 (후보 생성·평가·게이트) | `npm run quality -- benchmark tune-weights` |
| tune-report.ts | 튜닝 run 결과 리포트 출력 | `npm run quality -- benchmark tune-report` |
| migrate-embedding-data.js | 임베딩 데이터 마이그레이션 | `npm run migrate:embedding`, `node scripts/migrate-embedding-data.js analyze`, `node scripts/migrate-embedding-data.js rollback` |
| backup-memory-db.mjs | memory.db online backup (무인자 계약 유지) 및 backup backlog cleanup preview/apply | `npm run db:backup`, `npm run db:backup:cleanup`, `npm run db:backup:cleanup -- --apply` |
| pre-docker-deploy.mjs | 배포 전 백업 + quick_check | `npm run db:pre-docker-deploy` |
| restore-memory-db-from-corrupt.mjs | 손상 DB 테이블별 복구 | `npm run db:restore-from-corrupt` (인자: `--source`, `--target`, 선택 `--only-tables`) |
| db-residue-cleanup.ts | DB 잔재 report·dimensions=0 embedding cleanup | `npm run db:residue -- report`, `npm run db:residue -- cleanup-embeddings`, `npm run db:residue -- cleanup-embeddings --apply` |
| db-vacuum.ts | DELETE 후 공간 회수 측정 | `npm run db:vacuum` |
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
| 백업 | backup-daily.bat | 운영용. PRD 0019 등에서 참조. 미사용 시 제거 검토. |
| check-retry-usage.ts | 재시도 구현 정책 검증 | CI 또는 `npx tsx scripts/check-retry-usage.ts --ci` |

전체 목록은 `scripts/` 디렉터리를 참고하고, `package.json`의 `scripts` 필드에 등록된 항목을 우선 사용하세요.

`db:backup:cleanup`은 preview가 기본이며 삭제하지 않습니다. Apply는 `npm run db:backup:cleanup -- --apply`로만 실행하고, 그 전에 MCP 서버, restore 명령, 다른 cleanup/backup 작업을 중지하세요. Cleanup은 non-zero operator 백업을 보존하고 실패 보고에 절대 DB 경로를 포함하지 않습니다. `DB_PATH`를 지정할 때 `~`는 확장되지 않으므로 운영 환경에서는 절대 경로를 사용하세요.
