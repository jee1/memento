# 마이그레이션 시스템 사용 가이드

## 개요

Memento 프로젝트는 정식 마이그레이션 시스템을 사용하여 데이터베이스 스키마 변경을 안전하게 관리합니다. 이 문서는 마이그레이션 시스템의 인터페이스와 사용 방법을 설명합니다.

스키마를 변경한 뒤에는 **설계 문서**([docs/architecture/database-design.md](../architecture/database-design.md))의 해당 절(테이블·인덱스·마이그레이션 이력)을 함께 갱신한다.

## 마이그레이션 시스템 구조

### 핵심 컴포넌트

- **MigrationRunner**: 마이그레이션 실행 엔진 (`src/infrastructure/database/database/migration/migration-runner.ts`)
- **MigrationDetector**: 마이그레이션 자동 감지 (`src/infrastructure/database/database/migration/migration-detector.ts`)
- **BackupManager**: 백업 생성 및 복원 관리 (`src/infrastructure/database/database/migration/backup-manager.ts`)
- **SchemaVersionManager**: 스키마 버전 관리 (`src/infrastructure/database/database/migration/schema-version-manager.ts`)
- **MigrationLogger**: 마이그레이션 로깅 (`src/infrastructure/database/database/migration/migration-logger.ts`)

### 마이그레이션 디렉토리

마이그레이션 스크립트는 `src/infrastructure/database/database/migration/migrations/` 디렉토리에 위치합니다.

파일 명명 규칙: `{버전}-{이름}.ts`

예:
- `002-mirix-schema-expansion.ts`
- `003-consolidation-score-fields.ts`

## Migration 인터페이스

모든 마이그레이션 스크립트는 다음 인터페이스를 구현해야 합니다:

```typescript
export interface Migration {
  /**
   * 마이그레이션 버전 (예: "002")
   * 숫자 3자리 형식 권장 (예: "001", "002", "003")
   */
  version: string;

  /**
   * 마이그레이션 이름 (예: "mirix-schema-expansion")
   */
  name: string;

  /**
   * 마이그레이션 설명
   */
  description: string;

  /**
   * 마이그레이션 실행 (Up)
   * @param db 데이터베이스 인스턴스
   */
  up(db: Database.Database): Promise<void>;

  /**
   * 마이그레이션 롤백 (Down)
   * @param db 데이터베이스 인스턴스
   */
  down(db: Database.Database): Promise<void>;

  /**
   * 마이그레이션 전 검증
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  validateBefore(db: Database.Database): Promise<void>;

  /**
   * 마이그레이션 후 검증
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  validateAfter(db: Database.Database): Promise<void>;
}
```

## 마이그레이션 작성 예제

```typescript
import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class MirixSchemaExpansion implements Migration {
  version = '002';
  name = 'mirix-schema-expansion';
  description = 'MIRIX 스키마 확장 마이그레이션';

  async up(db: Database.Database): Promise<void> {
    // 마이그레이션 실행 로직
    db.exec(`
      ALTER TABLE memory_item 
      ADD COLUMN view_count INTEGER DEFAULT 0
    `);
  }

  async down(db: Database.Database): Promise<void> {
    // 롤백 로직 (SQLite는 ALTER TABLE DROP COLUMN을 지원하지 않으므로
    // 테이블 재생성이 필요할 수 있음)
    // 주의: 실제 롤백은 복잡할 수 있으므로 신중하게 구현해야 함
  }

  async validateBefore(db: Database.Database): Promise<void> {
    // 마이그레이션 전 상태 검증
    const tableInfo = db.prepare("PRAGMA table_info(memory_item)").all();
    const hasViewCount = tableInfo.some((col: any) => col.name === 'view_count');
    
    if (hasViewCount) {
      throw new Error('view_count 컬럼이 이미 존재합니다');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    // 마이그레이션 후 상태 검증
    const tableInfo = db.prepare("PRAGMA table_info(memory_item)").all();
    const hasViewCount = tableInfo.some((col: any) => col.name === 'view_count');
    
    if (!hasViewCount) {
      throw new Error('view_count 컬럼이 생성되지 않았습니다');
    }
  }
}

// default export 또는 named export
export default MirixSchemaExpansion;
```

## MigrationRunner API

### 생성자

```typescript
const runner = new MigrationRunner(db, logger?);
```

- `db`: Database.Database 인스턴스
- `logger`: MigrationLogger 인스턴스 (선택적)

### runMigration 메서드

```typescript
const result = await runner.runMigration(migration, options?);
```

**옵션:**

```typescript
interface MigrationOptions {
  createBackup?: boolean;  // 백업 생성 여부 (기본값: true)
  autoRollback?: boolean;  // 실패 시 자동 롤백 여부 (기본값: true)
  validate?: boolean;      // 검증 수행 여부 (기본값: true)
}
```

**반환값:**

```typescript
interface MigrationResult {
  version: string;
  name: string;
  success: boolean;
  startTime: Date;
  endTime?: Date;
  error?: Error;
  backupPath?: string;
}
```

### 사용 예제

```typescript
import Database from 'better-sqlite3';
import { MigrationRunner } from './migration-runner.js';
import { MirixSchemaExpansion } from './migrations/002-mirix-schema-expansion.js';

const db = new Database('data/memory.db');
const runner = new MigrationRunner(db);

const migration = new MirixSchemaExpansion();

try {
  const result = await runner.runMigration(migration, {
    createBackup: true,
    autoRollback: true,
    validate: true
  });

  if (result.success) {
    console.log(`✅ 마이그레이션 성공: ${result.name} (v${result.version})`);
  } else {
    console.error(`❌ 마이그레이션 실패: ${result.error?.message}`);
  }
} catch (error) {
  console.error('마이그레이션 실행 중 오류:', error);
} finally {
  db.close();
}
```

## MigrationDetector API

### 생성자

```typescript
const detector = new MigrationDetector(migrationsDir?);
```

- `migrationsDir`: 마이그레이션 디렉토리 경로 (기본값: `migrations/`)

### detectAllMigrations 메서드

모든 마이그레이션 파일을 감지합니다.

```typescript
const migrations = await detector.detectAllMigrations();
// 반환값: DetectedMigration[]
```

### detectPendingMigrations 메서드

실행해야 할 마이그레이션을 감지합니다.

```typescript
const result = await detector.detectPendingMigrations(db);
// 반환값: MigrationDetectionResult
```

**반환값 구조:**

```typescript
interface MigrationDetectionResult {
  pendingMigrations: DetectedMigration[];  // 실행해야 할 마이그레이션
  appliedMigrations: DetectedMigration[]; // 이미 실행된 마이그레이션
  currentVersion: string | null;           // 현재 스키마 버전
}
```

### 사용 예제

```typescript
import Database from 'better-sqlite3';
import { MigrationDetector } from './migration-detector.js';
import { MigrationRunner } from './migration-runner.js';

const db = new Database('data/memory.db');
const detector = new MigrationDetector();
const runner = new MigrationRunner(db);

// 실행해야 할 마이그레이션 감지
const detection = await detector.detectPendingMigrations(db);

console.log(`현재 버전: ${detection.currentVersion || '없음'}`);
console.log(`실행 대기 중인 마이그레이션: ${detection.pendingMigrations.length}개`);

// 각 마이그레이션 실행
for (const detected of detection.pendingMigrations) {
  console.log(`실행 중: ${detected.migration.name} (v${detected.migration.version})`);
  
  const result = await runner.runMigration(detected.migration);
  
  if (result.success) {
    console.log(`✅ 완료: ${detected.migration.name}`);
  } else {
    console.error(`❌ 실패: ${detected.migration.name}`);
    break; // 실패 시 중단
  }
}

db.close();
```

## 마이그레이션 실행 흐름

1. **마이그레이션 감지**: `MigrationDetector`가 미실행 마이그레이션 감지
2. **백업 생성**: `BackupManager`가 자동 백업 생성 (옵션)
3. **스키마 버전 확인**: `SchemaVersionManager`가 현재 스키마 버전 확인
4. **마이그레이션 전 검증**: `validateBefore` 실행
5. **마이그레이션 실행**: 트랜잭션 내에서 `up` 실행
6. **마이그레이션 후 검증**: `validateAfter` 실행
7. **스키마 버전 업데이트**: 성공 시 스키마 버전 기록
8. **롤백 (실패 시)**: 자동 롤백 또는 수동 복구 가이드 제공
9. **로깅**: 모든 단계를 로그 파일에 기록

## 마이그레이션 실행 방법

### CLI 명령어

```bash
# 마이그레이션 실행
npm run db:migrate

# 마이그레이션 상태 확인
npm run db:check-migration
```

### 프로그래밍 방식

```typescript
import { initializeDatabase } from './init.js';
import { MigrationDetector } from './migration-detector.js';
import { MigrationRunner } from './migration-runner.js';

const db = await initializeDatabase();
const detector = new MigrationDetector();
const runner = new MigrationRunner(db);

const detection = await detector.detectPendingMigrations(db);

for (const detected of detection.pendingMigrations) {
  await runner.runMigration(detected.migration);
}
```

## 주의사항

1. **트랜잭션**: 마이그레이션은 자동으로 트랜잭션 내에서 실행됩니다.
2. **백업**: 프로덕션 환경에서는 항상 백업을 생성하는 것을 권장합니다.
3. **롤백**: SQLite는 일부 DDL 작업(예: DROP COLUMN)을 지원하지 않으므로, `down` 메서드 구현 시 주의가 필요합니다.
4. **검증**: `validateBefore`와 `validateAfter`를 통해 마이그레이션 전후 상태를 검증하는 것을 강력히 권장합니다.
5. **버전 관리**: 마이그레이션 버전은 순차적으로 증가해야 하며, 이미 실행된 버전은 수정하지 않아야 합니다.

## 레거시 스크립트와의 차이점

### 레거시 스크립트 (simple-migrate.js, simple-update.js)

- 직접 SQL 실행
- 백업 수동 관리
- 버전 관리 없음
- 검증 로직 없음
- 롤백 지원 없음

### 정식 마이그레이션 시스템

- 구조화된 인터페이스
- 자동 백업 생성
- 스키마 버전 관리
- 전후 검증 지원
- 자동 롤백 지원
- 로깅 및 추적

## 마이그레이션 작성 체크리스트

- [ ] `Migration` 인터페이스 구현
- [ ] 버전 번호 설정 (3자리 숫자 형식)
- [ ] `up` 메서드 구현
- [ ] `down` 메서드 구현 (가능한 경우)
- [ ] `validateBefore` 메서드 구현
- [ ] `validateAfter` 메서드 구현
- [ ] 파일명 규칙 준수 (`{버전}-{이름}.ts`)
- [ ] default export 또는 named export 제공
- [ ] 테스트 작성 (선택적)

## 참고 자료

- [마이그레이션 시스템 README](../src/infrastructure/database/database/migration/README.md)
- [MigrationRunner 소스 코드](../src/infrastructure/database/database/migration/migration-runner.ts)
- [Migration 타입 정의](../src/infrastructure/database/database/migration/types.ts)

