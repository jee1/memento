# 데이터베이스 마이그레이션 상태 확인 가이드

현재 사용 중인 데이터베이스가 마이그레이션되었는지 확인하는 방법입니다.

## 🚀 빠른 확인 (CLI 스크립트)

### 방법 1: npm 스크립트 사용 (기본 경로)

```bash
npm run db:check-migration
```

이 명령어는 환경 변수 `DB_PATH` 또는 기본값(`./data/memory.db`)을 사용합니다.

### 방법 2: 특정 데이터베이스 경로 지정

npx로 설치된 환경이나 다른 경로의 데이터베이스를 확인하려면 경로를 인자로 전달하세요:

```bash
npm run db:check-migration /home/jee1lee/git/data/memento.db
```

### 방법 3: 환경 변수 사용

환경 변수 `DB_PATH`를 설정하여 데이터베이스 경로를 지정할 수도 있습니다:

```bash
DB_PATH=/home/jee1lee/git/data/memento.db npm run db:check-migration
```

### 방법 4: 직접 실행

```bash
# 권장: 루트에서 DB 마이그레이션 상태 점검 스크립트 실행
npm run db:check-migration [database-path]

# 또는 tsx로 직접 실행 (루트 src/scripts)
tsx src/scripts/check-migration-status.ts [database-path]
```

**표시되는 정보:**
- ✅ 데이터베이스 파일 존재 여부
- 📋 현재 스키마 버전
- 📝 적용된 마이그레이션 목록
- ⏳ 대기 중인 마이그레이션 목록
- 📊 주요 테이블 존재 여부

## 🔍 SQL로 직접 확인

### 1. 데이터베이스 연결

```bash
sqlite3 data/memory.db
```

### 2. 스키마 버전 테이블 확인

```sql
-- memento_schema_version 테이블 존재 확인
SELECT name FROM sqlite_master 
WHERE type='table' AND name='memento_schema_version';
```

### 3. 현재 스키마 버전 조회

```sql
-- 현재 스키마 버전 (가장 최근에 적용된 버전)
SELECT version, migration_name, applied_at, description
FROM memento_schema_version
ORDER BY applied_at DESC
LIMIT 1;
```

### 4. 모든 적용된 마이그레이션 목록

```sql
-- 모든 적용된 마이그레이션 목록
SELECT 
  version,
  migration_name,
  applied_at,
  applied_by,
  description
FROM memento_schema_version
ORDER BY applied_at ASC;
```

### 5. 주요 테이블 존재 확인

```sql
-- MIRIX 스키마 확장 후 생성된 테이블 확인
SELECT name FROM sqlite_master 
WHERE type='table' 
AND name IN ('core_memory', 'knowledge_vault', 'memento_schema_version');
```

### 6. memory_item 테이블의 새 컬럼 확인

```sql
-- origin_source, task_goal, steps, reflection_notes 컬럼 확인
PRAGMA table_info(memory_item);
```

## 📊 마이그레이션 상태 해석

### ✅ 정상 상태

```
현재 스키마 버전: 2.0
적용된 마이그레이션 수: 2
대기 중인 마이그레이션 수: 0
```

**의미:**
- 모든 마이그레이션이 적용되었습니다.
- 데이터베이스가 최신 상태입니다.

### ⚠️ 대기 중인 마이그레이션 있음

```
현재 스키마 버전: 1.0
적용된 마이그레이션 수: 1
대기 중인 마이그레이션 수: 1
```

**의미:**
- 아직 적용되지 않은 마이그레이션이 있습니다.
- 서버를 시작하면 자동으로 마이그레이션이 실행됩니다.

### ❌ 마이그레이션 시스템 미초기화

```
memento_schema_version 테이블: 없음
```

**의미:**
- 마이그레이션 시스템이 초기화되지 않았습니다.
- 서버를 시작하면 자동으로 초기화됩니다.

## 🔧 문제 해결

### 문제 1: 데이터베이스 파일을 찾을 수 없음

**원인:** npx로 설치된 환경이나 다른 경로의 데이터베이스를 확인하려고 할 때 발생할 수 있습니다.

**해결 방법:**

1. **경로를 인자로 지정:**
   ```bash
   npm run db:check-migration /path/to/your/memory.db
   ```

2. **환경 변수 설정:**
   ```bash
   # 환경 변수 확인
   echo $DB_PATH
   
   # 기본 경로: ./data/memory.db
   # 절대 경로로 지정 가능
   export DB_PATH=/path/to/your/memory.db
   npm run db:check-migration
   ```

3. **npx 환경에서 사용하는 데이터베이스 경로 확인:**
   - Cursor MCP 설정에서 `DB_PATH` 환경 변수 확인
   - 서버 로그에서 "📁 데이터베이스 경로" 메시지 확인

### 문제 2: 읽기 전용 모드 오류

데이터베이스가 다른 프로세스에서 사용 중일 수 있습니다. 서버를 중지한 후 다시 확인하세요.

### 문제 3: 마이그레이션이 적용되지 않음

1. 서버를 재시작하면 자동으로 마이그레이션이 실행됩니다.
2. 수동으로 마이그레이션을 실행하려면:

```bash
# 마이그레이션 수동 실행 (향후 구현 예정)
npm run db:migrate
```

## 📋 체크리스트

마이그레이션 상태 확인 체크리스트:

- [ ] 데이터베이스 파일이 존재하는가?
- [ ] `memento_schema_version` 테이블이 존재하는가?
- [ ] 현재 스키마 버전이 확인되는가?
- [ ] `core_memory` 테이블이 존재하는가? (MIRIX 확장 후)
- [ ] `knowledge_vault` 테이블이 존재하는가? (MIRIX 확장 후)
- [ ] `memory_item` 테이블에 `origin_source` 컬럼이 있는가?
- [ ] 대기 중인 마이그레이션이 없는가?

## 🔗 관련 문서

- [마이그레이션 시스템 README](../../../packages/memento-core/src/infrastructure/database/database/migration/README.md)
- [MIRIX 스키마 확장 PRD](../../../tasks/0003-prd-mirix-cognitive-schema-expansion.md)

