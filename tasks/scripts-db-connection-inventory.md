# Scripts DB 연결 사용 인벤토리

작업 3.1.1 결과: scripts/ 디렉토리에서 DB 연결을 사용하는 스크립트 목록

## 분석 기준
- `new Database(...)` - 직접 DB 연결 생성
- `initializeDatabase()` - 공통 모듈 사용
- `:memory:` - 메모리 DB만 사용 (실제 DB 연결 아님, 제외)

## 1. 이미 공통 모듈(initializeDatabase) 사용 중 (제외)

다음 스크립트들은 이미 `initializeDatabase`를 사용하므로 리팩토링 대상에서 제외:

1. **quality-report.ts**
   - 사용: `import { initializeDatabase } from '../src/infrastructure/database/database/init.js'`
   - 상태: ✅ 공통 모듈 사용 중

2. **quality-thresholds.ts**
   - 사용: `import { initializeDatabase } from '../src/infrastructure/database/database/init.js'`
   - 상태: ✅ 공통 모듈 사용 중

3. **generate-ground-truth.ts**
   - 사용: `import { initializeDatabase } from '../src/infrastructure/database/database/init.js'`
   - 상태: ✅ 공통 모듈 사용 중

## 2. 메모리 DB만 사용 (제외)

다음 스크립트들은 메모리 DB(`:memory:`)만 사용하므로 실제 DB 연결이 아니며 제외:

1. **generate-relation-report.ts**
   - 사용: `new Database(':memory:')`
   - 상태: ⚠️ 메모리 DB만 사용 (제외)

2. **weekly-relation-validation.ts**
   - 사용: `new Database(':memory:')`
   - 상태: ⚠️ 메모리 DB만 사용 (제외)

## 3. 리팩토링 대상 스크립트 (직접 DB 연결 사용)

다음 스크립트들은 `new Database(...)`를 직접 사용하므로 리팩토링 대상:

### 3.1 JavaScript 스크립트

1. **check-db-integrity.js**
   - 사용: `const Database = require('better-sqlite3'); const db = new Database(DB_PATH);`
   - 리팩토링 필요: ✅
   - 우선순위: 높음 (DB 무결성 검사)

2. **fix-migration.js**
   - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 높음 (마이그레이션 수정)

3. **migrate-embedding-data.js**
   - 사용: `import Database from 'better-sqlite3'; this.db = new Database(this.dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 높음 (임베딩 데이터 마이그레이션)

4. **regenerate-embeddings.js**
   - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 높음 (임베딩 재생성)

5. **debug-embeddings.js**
   - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 중간 (디버깅용)

6. **fix-vector-dimensions.js**
   - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 중간 (벡터 차원 수정)

7. **safe-migration.js**
   - 사용: `import Database from 'better-sqlite3'; const tempDb = new Database(tempDbPath); const db = new Database(dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 높음 (안전한 마이그레이션)

8. **run-migration.js**
   - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 높음 (마이그레이션 실행)

9. **simple-migrate.js**
   - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
   - 리팩토링 필요: ✅
   - 우선순위: 중간 (간단한 마이그레이션)

10. **simple-update.js**
    - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
    - 리팩토링 필요: ✅
    - 우선순위: 중간 (간단한 업데이트)

### 3.2 TypeScript 스크립트

11. **save-work-memory.ts**
    - 사용: `import Database from 'better-sqlite3'; db = new Database(dbPath); DatabaseUtils.initializeDatabase(db);`
    - 리팩토리 필요: ✅
    - 우선순위: 중간 (작업 메모리 저장)
    - 참고: `DatabaseUtils.initializeDatabase(db)`를 호출하지만, 여전히 직접 `new Database`를 사용함

12. **backup-embeddings.js**
    - 사용: `import Database from 'better-sqlite3'; const db = new Database(dbPath);`
    - 리팩토링 필요: ✅
    - 우선순위: 중간 (임베딩 백업)

## 4. 특수 케이스 (제외)

1. **auto-setup.js**
   - 사용: `better-sqlite3` 언급은 있지만 실제 DB 연결이 아님 (재빌드 관련)
   - 상태: ⚠️ DB 연결 스크립트가 아님 (제외)

## 최종 리팩토링 대상 목록

총 **12개** 스크립트가 리팩토링 대상:

### 높은 우선순위 (6개)
1. check-db-integrity.js
2. fix-migration.js
3. migrate-embedding-data.js
4. regenerate-embeddings.js
5. safe-migration.js
6. run-migration.js

### 중간 우선순위 (6개)
7. debug-embeddings.js
8. fix-vector-dimensions.js
9. simple-migrate.js
10. simple-update.js
11. save-work-memory.ts
12. backup-embeddings.js

## 다음 단계

1. 각 스크립트의 DB 연결 방식 상세 분석 (작업 3.1.2)
2. 공통 모듈 인터페이스 확인 및 문서화 (작업 3.2)
3. 우선순위에 따라 순차적으로 리팩토링 진행 (작업 3.3 ~ 3.7)

