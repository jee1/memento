# 마이그레이션 시스템 가이드

데이터베이스 스키마는 시간이 지나면서 반드시 변경됩니다. 변경 과정이 체계적으로 추적되지 않으면 운영 환경에서 데이터 손실이나 서버 기동 실패로 이어질 수 있습니다. Memento는 이 문제를 해결하기 위해 버전 관리·백업·검증을 모두 지원하는 정식 마이그레이션 시스템을 사용합니다.

스키마를 변경한 뒤에는 [database-design.md](../../architecture/ko/database-design.md)의 해당 절(테이블·인덱스·마이그레이션 이력)도 함께 갱신해야 합니다.

## 핵심 컴포넌트

마이그레이션 시스템은 `packages/memento-core/src/infrastructure/database/database/migration/` 아래에 위치하며 다섯 개의 컴포넌트로 구성됩니다.

**MigrationRunner**는 마이그레이션 실행 엔진입니다. 개별 마이그레이션을 트랜잭션 내에서 실행하고, 실패 시 자동 롤백을 시도하며, 실행 결과를 `MigrationResult` 객체로 반환합니다.

**MigrationDetector**는 마이그레이션 파일을 자동으로 감지하고, 이미 적용된 버전과 아직 실행되지 않은 버전을 구분합니다. `detectPendingMigrations(db)` 호출 하나로 현재 스키마 버전과 대기 중인 마이그레이션 목록을 얻을 수 있습니다.

**BackupManager**는 마이그레이션 전 자동 백업을 생성하고 복원을 관리합니다. 프로덕션 환경에서는 항상 백업 옵션을 활성화하는 것이 권장됩니다.

**SchemaVersionManager**는 각 마이그레이션의 적용 여부를 DB에 기록하여 현재 스키마 버전을 추적합니다.

**MigrationLogger**는 마이그레이션 전 과정(시작·완료·실패)을 로그 파일에 기록합니다.

## 마이그레이션 파일 위치

정식 마이그레이션은 다음 경로에 위치합니다.

```
packages/memento-core/src/infrastructure/database/database/migration/migrations/
```

파일 명명 규칙은 `{버전}-{이름}.ts`입니다. 버전은 3자리 숫자 형식을 권장합니다.

- `002-mirix-schema-expansion.ts`
- `003-consolidation-score-fields.ts`
- `014-procedural-version-indexes.ts`

같은 `database/` 디렉터리 아래에 `migration/migrations/`(정식)와 `migrations/`(레거시 SQL) 두 경로가 공존하는 구조에 주의하십시오. 새 마이그레이션은 반드시 `migration/migrations/`(정식 시스템)에 추가합니다.

## Migration 인터페이스

모든 마이그레이션 파일은 다음 인터페이스를 구현해야 합니다.

```typescript
export interface Migration {
  version: string;      // "014" 형식 — 3자리 숫자 권장
  name: string;         // "procedural-version-indexes" 형식
  description: string;  // 변경 내용 요약

  up(db: Database.Database): Promise<void>;           // 마이그레이션 실행
  down(db: Database.Database): Promise<void>;         // 롤백 (가능한 경우)
  validateBefore(db: Database.Database): Promise<void>; // 실행 전 상태 검증
  validateAfter(db: Database.Database): Promise<void>;  // 실행 후 상태 검증
}
```

`validateBefore`와 `validateAfter`는 선택이 아닌 권장 사항입니다. 마이그레이션이 이미 적용된 환경에서 재실행되더라도 오류 없이 처리되려면, `validateBefore`에서 중복 적용 여부를 확인하는 것이 좋습니다.

## 마이그레이션 작성 예제

```typescript
import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class AddViewCountColumn implements Migration {
  version = '015';
  name = 'add-view-count-column';
  description = 'memory_item 테이블에 view_count 컬럼 추가';

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      ALTER TABLE memory_item
      ADD COLUMN view_count INTEGER DEFAULT 0
    `);
  }

  async down(db: Database.Database): Promise<void> {
    // SQLite는 ALTER TABLE DROP COLUMN을 지원하지 않으므로
    // 필요 시 테이블 재생성 방식으로 구현해야 합니다.
    // 대부분의 경우 BackupManager를 통한 복원이 더 안전합니다.
  }

  async validateBefore(db: Database.Database): Promise<void> {
    const cols = db.prepare("PRAGMA table_info(memory_item)").all() as Array<{ name: string }>;
    if (cols.some(c => c.name === 'view_count')) {
      throw new Error('view_count 컬럼이 이미 존재합니다 — 마이그레이션 중복 적용 방지');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const cols = db.prepare("PRAGMA table_info(memory_item)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'view_count')) {
      throw new Error('view_count 컬럼이 생성되지 않았습니다');
    }
  }
}

export default AddViewCountColumn;
```

## 실행 흐름

`MigrationRunner.runMigration(migration, options)`을 호출하면 다음 순서로 실행됩니다.

1. `BackupManager`가 옵션에 따라 자동 백업을 생성합니다.
2. `SchemaVersionManager`가 현재 스키마 버전을 확인합니다.
3. `validateBefore(db)`를 실행하여 사전 조건을 검증합니다.
4. 트랜잭션 내에서 `up(db)`를 실행합니다.
5. `validateAfter(db)`를 실행하여 사후 상태를 검증합니다.
6. 성공하면 스키마 버전 레코드를 기록합니다.
7. 실패하면 `autoRollback` 옵션에 따라 자동으로 트랜잭션을 롤백합니다.
8. 모든 단계가 `MigrationLogger`에 기록됩니다.

## CLI 명령어

```bash
npm run db:migrate           # 대기 중인 마이그레이션 실행
npm run db:check-migration   # 마이그레이션 상태 확인
npm run db:init              # DB 스키마 초기화 (최초 1회)
```

## 프로그래밍 방식으로 실행

자동화 스크립트나 서버 초기화 코드에서 마이그레이션을 실행할 때는 다음 패턴을 사용합니다.

```typescript
import Database from 'better-sqlite3';
import { MigrationDetector } from './migration-detector.js';
import { MigrationRunner } from './migration-runner.js';

const db = new Database(process.env.DB_PATH ?? '~/.memento/memory.db');
const detector = new MigrationDetector();
const runner = new MigrationRunner(db);

const detection = await detector.detectPendingMigrations(db);

if (detection.pendingMigrations.length === 0) {
  console.log('적용할 마이그레이션 없음');
} else {
  for (const detected of detection.pendingMigrations) {
    const result = await runner.runMigration(detected.migration, {
      createBackup: true,
      autoRollback: true,
      validate: true,
    });

    if (!result.success) {
      console.error(`마이그레이션 실패: ${result.name}`, result.error);
      break;
    }
  }
}

db.close();
```

## 마이그레이션 작성 시 주의사항

SQLite는 `ALTER TABLE DROP COLUMN`을 포함한 일부 DDL 변경을 지원하지 않습니다. 컬럼 삭제나 타입 변경이 필요한 경우 새 테이블을 만들고 데이터를 복사한 뒤 기존 테이블을 교체하는 방식으로 구현해야 합니다. 이런 이유로 마이그레이션을 한 번 적용한 뒤에는 수정하지 말고, 수정이 필요하다면 새 버전을 추가합니다.

마이그레이션 작성 체크리스트:

- `Migration` 인터페이스 구현 (version, name, description, up, down, validateBefore, validateAfter)
- 버전 번호가 기존 마이그레이션과 충돌하지 않는지 확인
- `validateBefore`에서 중복 적용 방지 로직 구현
- `validateAfter`에서 변경이 실제로 적용되었는지 검증
- 파일명이 `{버전}-{이름}.ts` 규칙을 따르는지 확인
- `default export` 또는 named export로 클래스 노출
