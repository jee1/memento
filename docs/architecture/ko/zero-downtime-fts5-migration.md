# Zero-Downtime FTS5 마이그레이션 전략

## 개요

이 문서는 `memory_item_fts` FTS5 가상 테이블에 `reflection_notes` 컬럼을 추가하는 Zero-Downtime 마이그레이션 전략을 설명합니다.

FTS5는 ALTER TABLE을 지원하지 않으므로, 기존 테이블을 삭제하고 새 테이블을 생성해야 합니다. Zero-Downtime 전략을 통해 마이그레이션 중에도 검색 기능이 중단되지 않도록 보장합니다.

## 목표

1. **다운타임 제로**: 마이그레이션 중에도 검색 기능 정상 동작
2. **데이터 무결성**: 기존 데이터 손실 없음
3. **원자적 교체**: 마이그레이션 실패 시 롤백 가능
4. **성능 최소화**: 마이그레이션 중 성능 저하 최소화

## 마이그레이션 단계별 상세 절차

### 1단계: 새 FTS5 테이블 생성

**목적**: `reflection_notes` 컬럼을 포함한 새 FTS5 테이블 생성

**절차**:
```sql
CREATE VIRTUAL TABLE memory_item_fts_new USING fts5(
  content,
  tags,
  source,
  reflection_notes,  -- 새로 추가되는 컬럼
  content='memory_item',
  content_rowid='rowid'
);
```

**트랜잭션 범위**: 단일 트랜잭션
**롤백 가능 지점**: 이 단계에서 실패 시 롤백 불필요 (테이블 생성 실패는 자동 롤백)

**예상 시간**: < 1초

### 2단계: 기존 데이터 재인덱싱

**목적**: `memory_item` 테이블의 모든 row를 새 FTS5 테이블에 인덱싱

**절차**:
```sql
-- 배치 처리로 성능 최적화 (예: 1000개씩)
INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
SELECT 
  rowid,
  content,
  tags,
  source,
  reflection_notes  -- NULL이거나 JSON 형식
FROM memory_item
ORDER BY rowid
LIMIT ? OFFSET ?;
```

**트랜잭션 범위**: 배치별 트랜잭션 (각 배치마다 커밋)
**롤백 가능 지점**: 각 배치별 롤백 가능

**성능 최적화**:
- 배치 크기: 1000개 (조정 가능)
- 배치 간 지연: 10ms (다른 작업에 영향 최소화)
- 진행 상황 로깅: 10% 단위로 진행률 로그

**예상 시간**: 
- 10,000개 레코드: 약 5초
- 100,000개 레코드: 약 50초
- 1,000,000개 레코드: 약 8분

### 3단계: 임시 이중 트리거 생성

**목적**: 마이그레이션 중 발생하는 INSERT/UPDATE를 기존 테이블과 새 테이블 모두에 반영

**절차**:
```sql
-- 임시 이중 트리거 생성 (기존 트리거는 유지)
CREATE TRIGGER memory_item_fts_insert_new AFTER INSERT ON memory_item BEGIN
  INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
  VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
END;

CREATE TRIGGER memory_item_fts_update_new AFTER UPDATE ON memory_item BEGIN
  INSERT INTO memory_item_fts_new(memory_item_fts_new, rowid, content, tags, source, reflection_notes)
  VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
  INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
  VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
END;

CREATE TRIGGER memory_item_fts_delete_new AFTER DELETE ON memory_item BEGIN
  INSERT INTO memory_item_fts_new(memory_item_fts_new, rowid, content, tags, source, reflection_notes)
  VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
END;
```

**트랜잭션 범위**: 단일 트랜잭션
**롤백 가능 지점**: 이 단계에서 실패 시 롤백 불필요 (트리거 생성 실패는 자동 롤백)

**이중 삽입 방지**:
- 트랜잭션 내에서 중복 방지 로직 구현
- 트리거 내에서 조건부 삽입 (이미 존재하는 경우 스킵)

**예상 시간**: < 1초

### 4단계: 원자적 테이블 교체

**목적**: 기존 테이블을 삭제하고 새 테이블을 원자적으로 교체

**절차**:
```sql
BEGIN TRANSACTION;

-- 1. 기존 트리거 삭제
DROP TRIGGER IF EXISTS memory_item_fts_insert;
DROP TRIGGER IF EXISTS memory_item_fts_update;
DROP TRIGGER IF EXISTS memory_item_fts_delete;

-- 2. 임시 이중 트리거 삭제
DROP TRIGGER IF EXISTS memory_item_fts_insert_new;
DROP TRIGGER IF EXISTS memory_item_fts_update_new;
DROP TRIGGER IF EXISTS memory_item_fts_delete_new;

-- 3. 기존 FTS5 테이블 삭제
DROP TABLE IF EXISTS memory_item_fts;

-- 4. 새 테이블을 기존 이름으로 변경
ALTER TABLE memory_item_fts_new RENAME TO memory_item_fts;

-- 5. 새 트리거 생성 (reflection_notes 포함)
CREATE TRIGGER memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
  INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
  VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
END;

CREATE TRIGGER memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
  INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
  VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
  INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
  VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
END;

CREATE TRIGGER memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
  INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
  VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
END;

COMMIT;
```

**트랜잭션 범위**: 단일 트랜잭션 (원자적 교체 보장)
**롤백 가능 지점**: 이 단계에서 실패 시 전체 롤백

**예상 시간**: < 1초

### 5단계: 새 트리거 활성화

**목적**: reflection_notes를 포함한 새 트리거 활성화

**절차**: 4단계에서 이미 완료됨 (트리거 생성)

**트랜잭션 범위**: 4단계와 동일한 트랜잭션
**롤백 가능 지점**: 4단계와 동일

## 트랜잭션 경계 명확화

### 각 단계별 트랜잭션 범위

| 단계 | 트랜잭션 범위 | 롤백 가능 지점 | 롤백 방법 |
|------|-------------|---------------|----------|
| 1. 새 테이블 생성 | 단일 트랜잭션 | 자동 롤백 | DROP TABLE IF EXISTS |
| 2. 기존 데이터 재인덱싱 | 배치별 트랜잭션 | 각 배치별 | 배치별 롤백, 진행 상황 저장 |
| 3. 임시 이중 트리거 생성 | 단일 트랜잭션 | 자동 롤백 | DROP TRIGGER IF EXISTS |
| 4. 원자적 테이블 교체 | 단일 트랜잭션 | 전체 롤백 | 전체 롤백 또는 수동 복구 |
| 5. 새 트리거 활성화 | 4단계와 동일 | 4단계와 동일 | 4단계와 동일 |

### 롤백 가능 지점

1. **1단계 실패**: 자동 롤백, 기존 테이블 유지
2. **2단계 실패**: 
   - 배치별 롤백 가능
   - 진행 상황 저장하여 재시도 가능
   - 실패 시 `memory_item_fts_new` 삭제 후 재시도
3. **3단계 실패**: 자동 롤백, 임시 트리거 삭제
4. **4단계 실패**: 전체 롤백, 기존 테이블 유지, 임시 트리거 정리

## 트리거 전환 순서

### 전환 전 상태
- 기존 트리거: `memory_item_fts`에 삽입
- 임시 이중 트리거: 없음

### 전환 중 상태 (3단계)
- 기존 트리거: `memory_item_fts`에 삽입 (유지)
- 임시 이중 트리거: `memory_item_fts_new`에 삽입 (활성화)
- 결과: 두 테이블 모두에 동시 삽입

### 전환 후 상태 (4-5단계)
- 기존 트리거: 삭제
- 임시 이중 트리거: 삭제
- 새 트리거: `memory_item_fts`에 삽입 (reflection_notes 포함)

## 신규 write 동기화 전략

### 선택된 전략: 이중 트리거 전략

**이유**:
- 구현 단순성: 트리거만 추가하면 됨
- 성능: 트리거 오버헤드 최소화
- 안정성: 트랜잭션 내에서 자동 동기화

### 대안 전략: 버퍼 테이블 전략 (구현하지 않음)

**이유**:
- 복잡도: 버퍼 테이블 관리, 배치 처리 로직 필요
- 성능: 배치 처리 지연 발생
- 구현 비용: 높음

**결론**: 이중 트리거 전략 선택

### 이중 트리거 전략 상세

**동작 방식**:
1. 마이그레이션 중 INSERT/UPDATE 발생
2. 기존 트리거: `memory_item_fts`에 삽입
3. 임시 이중 트리거: `memory_item_fts_new`에 삽입
4. 결과: 두 테이블 모두 최신 상태 유지

**이중 삽입 방지**:
- 트리거 내에서 조건부 삽입 (이미 존재하는 경우 스킵)
- 트랜잭션 내에서 중복 방지 로직 구현
- 성능 최적화: EXISTS 체크 최소화

### 신규 write 동기화 테스트 시나리오

1. **마이그레이션 중 INSERT 발생**:
   - `memory_item`에 새 레코드 INSERT
   - 기존 트리거: `memory_item_fts`에 삽입 확인
   - 임시 이중 트리거: `memory_item_fts_new`에 삽입 확인
   - 검증: 두 테이블 모두 동일한 데이터 포함

2. **마이그레이션 중 UPDATE 발생**:
   - `memory_item`의 기존 레코드 UPDATE
   - 기존 트리거: `memory_item_fts`에 업데이트 반영 확인
   - 임시 이중 트리거: `memory_item_fts_new`에 업데이트 반영 확인
   - 검증: 두 테이블 모두 동일한 데이터 포함

3. **마이그레이션 중 reflection_notes 업데이트**:
   - `memory_item`의 `reflection_notes` 필드 UPDATE
   - 기존 트리거: `memory_item_fts`에는 reflection_notes 없음 (정상)
   - 임시 이중 트리거: `memory_item_fts_new`에 reflection_notes 포함 확인
   - 검증: 새 테이블에만 reflection_notes 반영

## 롤백 절차

### 각 단계별 롤백 방법

#### 1단계 롤백
```sql
DROP TABLE IF EXISTS memory_item_fts_new;
```

#### 2단계 롤백
```sql
-- 진행 상황 확인
SELECT * FROM memento_schema_version WHERE version = '006-fts5-reflection-notes';

-- 새 테이블 삭제
DROP TABLE IF EXISTS memory_item_fts_new;

-- 상태를 'pending'으로 되돌림
UPDATE memento_schema_version 
SET applied_at = NULL, checksum = NULL 
WHERE version = '006-fts5-reflection-notes';
```

#### 3단계 롤백
```sql
DROP TRIGGER IF EXISTS memory_item_fts_insert_new;
DROP TRIGGER IF EXISTS memory_item_fts_update_new;
DROP TRIGGER IF EXISTS memory_item_fts_delete_new;
```

#### 4단계 롤백
```sql
BEGIN TRANSACTION;

-- 새 트리거 삭제
DROP TRIGGER IF EXISTS memory_item_fts_insert;
DROP TRIGGER IF EXISTS memory_item_fts_update;
DROP TRIGGER IF EXISTS memory_item_fts_delete;

-- 테이블 이름 되돌리기
ALTER TABLE memory_item_fts RENAME TO memory_item_fts_new;

-- 기존 테이블 복구 (content 테이블 참조로 자동 재생성 불가, 수동 복구 필요)
-- 또는 기존 백업에서 복구

-- 기존 트리거 복구
CREATE TRIGGER memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
  INSERT INTO memory_item_fts(rowid, content, tags, source)
  VALUES (new.rowid, new.content, new.tags, new.source);
END;

-- (나머지 트리거도 동일하게 복구)

COMMIT;
```

**주의**: 4단계 롤백은 복잡하므로, 가능하면 4단계 전에 롤백하는 것이 안전합니다.

### 데이터 무결성 보장

1. **트랜잭션 사용**: 모든 단계에서 트랜잭션 사용
2. **상태 추적**: `memento_schema_version` 테이블에 마이그레이션 상태 저장
3. **검증**: 각 단계 후 데이터 무결성 검증
4. **백업**: 마이그레이션 전 백업 권장 (선택적)

## 예상 다운타임 및 성능 영향 분석

### 다운타임 분석

| 단계 | 다운타임 | 영향 범위 |
|------|---------|----------|
| 1. 새 테이블 생성 | 0초 | 없음 (읽기/쓰기 정상) |
| 2. 기존 데이터 재인덱싱 | 0초 | 없음 (읽기/쓰기 정상, 성능 약간 저하 가능) |
| 3. 임시 이중 트리거 생성 | 0초 | 없음 (읽기/쓰기 정상) |
| 4. 원자적 테이블 교체 | 0초 | 없음 (트랜잭션 내에서 원자적 교체) |
| 5. 새 트리거 활성화 | 0초 | 없음 (4단계와 동일) |

**총 다운타임**: 0초 (Zero-Downtime)

### 성능 영향 분석

#### 2단계: 기존 데이터 재인덱싱

**영향**:
- CPU 사용률: 증가 (인덱싱 작업)
- 디스크 I/O: 증가 (FTS5 인덱스 쓰기)
- 메모리: 증가 (배치 처리 버퍼)

**완화 전략**:
- 배치 처리: 1000개씩 처리하여 부하 분산
- 배치 간 지연: 10ms로 다른 작업에 영향 최소화
- 진행 상황 로깅: 10% 단위로 진행률 로그

**예상 성능 저하**:
- 검색 응답 시간: +10-20% (인덱싱 작업 중)
- 쓰기 응답 시간: +5-10% (이중 트리거 오버헤드)

#### 3단계: 임시 이중 트리거

**영향**:
- 쓰기 응답 시간: +5-10% (이중 트리거 오버헤드)
- 검색 응답 시간: 영향 없음

**완화 전략**:
- 트리거 최적화: 조건부 삽입으로 불필요한 작업 최소화
- 트랜잭션 최적화: 중복 방지 로직 효율화

### 대용량 데이터 재인덱싱 시간

| 레코드 수 | 예상 시간 | 배치 수 |
|----------|----------|---------|
| 10,000 | 약 5초 | 10 |
| 100,000 | 약 50초 | 100 |
| 1,000,000 | 약 8분 | 1,000 |
| 10,000,000 | 약 80분 | 10,000 |

**최적화 방안**:
- 배치 크기 조정: 시스템 리소스에 따라 조정
- 병렬 처리: 가능한 경우 병렬 처리 (주의 필요)
- 진행 상황 저장: 중단 시 재시도 가능

### 검색 공백 최소화 전략

1. **마이그레이션 중 검색**: 기존 `memory_item_fts` 테이블로 검색 계속 제공
2. **reflection_notes 검색**: 마이그레이션 완료 전까지 LIKE 쿼리로 대체
3. **마이그레이션 완료 후**: 즉시 FTS5 검색으로 전환

**Fallback 전략**:
- 마이그레이션 상태 확인: `memento_schema_version` 테이블에서 상태 확인
- 상태별 분기:
  - `pending`: LIKE 쿼리 사용
  - `in_progress`: LIKE 쿼리 사용
  - `completed`: FTS5 검색 사용
  - `failed`: LIKE 쿼리 사용

## 마이그레이션 상태 관리

### 상태 전이 다이어그램

```
pending → in_progress → completed
              ↓
            failed → pending (재시도)
```

**상태 설명**:
- `pending`: 마이그레이션 대기 중
- `in_progress`: 마이그레이션 진행 중
- `completed`: 마이그레이션 완료
- `failed`: 마이그레이션 실패

### 상태 저장 위치

- **데이터베이스**: `memento_schema_version` 테이블
- **런타임 캐시**: `mementoConfig.fts5MigrationStatus`

### 상태 업데이트 책임

- **마이그레이션 스크립트**: 시작 시 `in_progress`, 성공 시 `completed`, 실패 시 `failed`
- **애플리케이션 부팅**: DB 상태를 읽어 config에 캐시
- **동기화**: DB와 config 동시 업데이트

## 검증 체크리스트

### 마이그레이션 전 검증

- [ ] 기존 FTS5 테이블 정상 동작 확인
- [ ] 백업 완료 (선택적)
- [ ] 마이그레이션 상태 `pending` 확인

### 마이그레이션 중 검증

- [ ] 2단계: 재인덱싱 진행률 확인
- [ ] 3단계: 이중 트리거 정상 동작 확인
- [ ] 신규 write 동기화 확인 (INSERT/UPDATE 테스트)

### 마이그레이션 후 검증

- [ ] 새 FTS5 테이블 정상 동작 확인
- [ ] reflection_notes 검색 정상 동작 확인
- [ ] 기존 검색 기능 정상 동작 확인
- [ ] 데이터 무결성 검증 (레코드 수 비교)
- [ ] 마이그레이션 상태 `completed` 확인

## 참고 사항

1. **FTS5 제약사항**: ALTER TABLE 미지원, 따라서 테이블 재생성 필요
2. **Content 테이블 참조**: `content='memory_item'` 옵션으로 원본 테이블 참조
3. **트리거 의존성**: 트리거는 테이블과 독립적으로 관리 가능
4. **롤백 복잡도**: 4단계 롤백은 복잡하므로 신중하게 진행

## 결론

이 Zero-Downtime 마이그레이션 전략을 통해 `reflection_notes` 컬럼을 추가하면서도 검색 기능의 중단 없이 안전하게 마이그레이션할 수 있습니다. 각 단계는 원자적으로 처리되며, 실패 시 롤백이 가능합니다.

