# 데이터베이스 마이그레이션 시스템

## 디렉토리 구조

```
packages/memento-core/src/infrastructure/database/database/migration/
├── README.md                    # 이 파일
├── types.ts                     # 마이그레이션 타입 정의
├── migration-runner.ts          # 마이그레이션 실행 엔진
├── migration-detector.ts        # 마이그레이션 자동 감지
├── backup-manager.ts            # 백업 생성 및 복원 관리
├── schema-version-manager.ts    # 스키마 버전 관리
└── migrations/                  # 마이그레이션 스크립트 디렉터리
    ├── 002-mirix-schema-expansion.ts  # MIRIX 스키마 확장 마이그레이션
    └── ...
```

## 마이그레이션 스크립트 구조

각 마이그레이션 스크립트는 다음 인터페이스를 구현해야 합니다:

```typescript
export interface Migration {
  version: string;              // 마이그레이션 버전 (예: "002")
  name: string;                  // 마이그레이션 이름
  description: string;          // 마이그레이션 설명
  
  // 마이그레이션 실행 (Up)
  up(db: Database.Database): Promise<void>;
  
  // 마이그레이션 롤백 (Down)
  down(db: Database.Database): Promise<void>;
  
  // 마이그레이션 전 검증
  validateBefore(db: Database.Database): Promise<void>;
  
  // 마이그레이션 후 검증
  validateAfter(db: Database.Database): Promise<void>;
}
```

## 마이그레이션 실행 흐름

1. **마이그레이션 감지**: `migration-detector.ts`가 미실행 마이그레이션 감지
2. **백업 생성**: `backup-manager.ts`가 자동 백업 생성
3. **스키마 버전 확인**: `schema-version-manager.ts`가 현재 스키마 버전 확인
4. **마이그레이션 실행**: `migration-runner.ts`가 트랜잭션 내에서 마이그레이션 실행
5. **검증**: 마이그레이션 전/후 검증 수행
6. **롤백 (실패 시)**: 자동 롤백 또는 수동 복구 가이드 제공
7. **로깅**: 모든 단계를 로그 파일에 기록

## 스키마 버전 관리

`memento_schema_version` 테이블을 사용하여 스키마 버전을 추적합니다:

```sql
CREATE TABLE IF NOT EXISTS memento_schema_version (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  migration_name TEXT NOT NULL,
  checksum TEXT,  -- 마이그레이션 스크립트 체크섬
  applied_by TEXT DEFAULT 'system'
);
```

## 마이그레이션 파일 명명 규칙

- 형식: `{순번}-{이름}.ts`
- 예시: `002-mirix-schema-expansion.ts`
- 순번은 3자리 숫자로 시작 (001, 002, 003, ...)

## 로깅

마이그레이션 로그는 `data/logs/migration_{timestamp}.log`에 기록됩니다.

## 백업

마이그레이션 전 자동 백업은 `data/backups/memory-backup-{timestamp}.db`에 저장됩니다.
백업 보존 기간: 기본 30일 (설정 가능)

