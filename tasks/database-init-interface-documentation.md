# 공통 DB 연결 모듈 인터페이스 문서

작업 3.2.1 결과: `initializeDatabase` 함수 인터페이스 분석 및 문서화

## 파일 위치

- **모듈 경로**: `src/infrastructure/database/database/init.ts`
- **함수명**: `initializeDatabase`
- **export 타입**: Named export

## 함수 시그니처

```typescript
export async function initializeDatabase(): Promise<Database.Database>
```

## 인터페이스 상세

### 매개변수

없음 (매개변수 없음)

### 반환 타입

- **타입**: `Promise<Database.Database>`
- **설명**: `better-sqlite3`의 `Database` 인스턴스를 반환하는 Promise
- **비동기**: `async` 함수이므로 `await` 또는 `.then()` 사용 필요

### 동작 방식

1. **DB 경로 결정**
   - `mementoConfig.dbPath`를 사용하여 데이터베이스 경로 결정
   - 환경 변수 또는 기본값에서 가져옴

2. **디렉토리 생성**
   - DB 파일이 위치할 디렉토리가 없으면 자동 생성

3. **데이터베이스 연결**
   - `better-sqlite3`를 사용하여 SQLite 데이터베이스 연결 생성

4. **초기 설정 적용**
   - WAL 모드 활성화 (동시 읽기 성능 향상)
   - 외래키 제약 조건 활성화
   - 성능 최적화 PRAGMA 설정
   - 사용자 정의 함수 등록 (`normalize_reflection_notes`)

5. **확장 로드**
   - FTS5 확장 로드 시도 (텍스트 검색)
   - sqlite-vec 확장 로드 시도 (벡터 검색)

6. **마이그레이션 실행**
   - 기존 DB가 있으면 마이그레이션 먼저 실행
   - 새 DB인 경우 마이그레이션 또는 schema.sql 실행

7. **Core Memory 자동 로드**
   - `always_load=true`인 Core Memory 항목 자동 로드

8. **FTS5 마이그레이션 상태 초기화**
   - FTS5 마이그레이션 상태 테이블 초기화 및 상태 로드

## 사용 예제

### 기본 사용법 (TypeScript)

```typescript
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';
import Database from 'better-sqlite3';

async function main() {
  try {
    // 데이터베이스 초기화 및 연결
    const db = await initializeDatabase();
    
    // 데이터베이스 사용
    const result = db.prepare('SELECT COUNT(*) as count FROM memory_item').get();
    console.log(`메모리 항목 수: ${result.count}`);
    
    // 작업 완료 후 데이터베이스 닫기 (선택사항)
    db.close();
  } catch (error) {
    console.error('데이터베이스 초기화 실패:', error);
    process.exit(1);
  }
}

main();
```

### JavaScript에서 사용 (CommonJS)

```javascript
const { initializeDatabase } = require('../dist/infrastructure/database/database/init.js');

async function main() {
  try {
    const db = await initializeDatabase();
    
    // 데이터베이스 사용
    const result = db.prepare('SELECT COUNT(*) as count FROM memory_item').get();
    console.log(`메모리 항목 수: ${result.count}`);
    
    db.close();
  } catch (error) {
    console.error('데이터베이스 초기화 실패:', error);
    process.exit(1);
  }
}

main();
```

### 에러 처리

```typescript
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';

async function main() {
  try {
    const db = await initializeDatabase();
    // 데이터베이스 작업 수행
  } catch (error) {
    if (error instanceof Error) {
      console.error('데이터베이스 초기화 실패:', error.message);
      // PII 마스킹이 필요한 경우
      const { PIIMasker } = await import('../src/shared/utils/pii-masker.js');
      const maskedError = PIIMasker.maskError(error);
      console.error('마스킹된 에러:', maskedError.message);
    } else {
      console.error('알 수 없는 오류:', String(error));
    }
    process.exit(1);
  }
}
```

### 데이터베이스 닫기

```typescript
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';

async function main() {
  const db = await initializeDatabase();
  
  try {
    // 데이터베이스 작업 수행
  } finally {
    // 작업 완료 후 데이터베이스 닫기
    closeDatabase(db);
  }
}
```

## 기존 사용 예제 (참고)

### quality-report.ts

```typescript
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';

async function generateReport() {
  const db = await initializeDatabase();
  
  try {
    // 리포트 생성 로직
  } finally {
    db.close();
  }
}
```

### quality-thresholds.ts

```typescript
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';

async function manageThresholds() {
  const db = await initializeDatabase();
  
  try {
    // 임계값 관리 로직
  } finally {
    db.close();
  }
}
```

## 주의사항

1. **비동기 함수**: `await` 또는 `.then()`을 사용하여 Promise를 처리해야 함
2. **에러 처리**: 항상 try-catch로 에러를 처리해야 함
3. **데이터베이스 닫기**: 작업 완료 후 `db.close()` 또는 `closeDatabase(db)` 호출 권장
4. **경로 설정**: DB 경로는 `mementoConfig.dbPath`를 통해 결정되므로 환경 변수 설정 확인 필요
5. **마이그레이션**: 함수 내부에서 자동으로 마이그레이션을 실행하므로 별도 실행 불필요

## 마이그레이션 가이드

### 기존 코드 (직접 DB 연결)

```typescript
// ❌ 기존 방식 (리팩토링 대상)
import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'data', 'memory.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// ... 추가 설정
```

### 새로운 코드 (공통 모듈 사용)

```typescript
// ✅ 새로운 방식 (권장)
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';

const db = await initializeDatabase();
// 모든 초기화가 자동으로 완료됨
```

## 장점

1. **일관성**: 모든 스크립트가 동일한 방식으로 DB를 초기화
2. **자동화**: 마이그레이션, 확장 로드, 설정 등이 자동으로 처리됨
3. **유지보수성**: DB 초기화 로직이 한 곳에 집중되어 수정이 용이
4. **안정성**: 검증된 초기화 로직을 재사용하여 버그 위험 감소
5. **확장성**: 새로운 초기화 로직 추가 시 모든 스크립트에 자동 적용

## 관련 함수

- `closeDatabase(db: Database.Database): void` - 데이터베이스 연결 종료
- `mementoConfig` - 데이터베이스 경로 등 설정 정보

## 참고 자료

- `src/infrastructure/database/database/init.ts` - 구현 파일
- `src/shared/config/index.ts` - 설정 파일 (mementoConfig)
- `scripts/quality-report.ts` - 사용 예제 1
- `scripts/quality-thresholds.ts` - 사용 예제 2
- `scripts/generate-ground-truth.ts` - 사용 예제 3

