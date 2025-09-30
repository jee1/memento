# MCP Memory Server M1 상세 설계 문서

## 1. 목적

본 단계(M1)는 개인 사용자가 로컬 환경에서 가볍게 실행할 수 있는 기억 보조 MCP 서버를 구현하는 것을 목표로 한다.
데이터베이스는 별도의 설치 없이 사용할 수 있는 SQLite 임베디드 DB를 사용하며, MCP 인터페이스를 통해 기억 저장, 검색, 삭제, 고정 등의 기본 기능을 제공한다.

## 2. 전체 아키텍처

- **클라이언트**: MCP를 지원하는 IDE(예: Cursor) 또는 AI Agent
- **서버**: MCP Memory Server (Node.js/TypeScript 기반)
- **스토리지**: SQLite 데이터베이스(memory.db 파일)

**구조**:
```
[Client/Agent] ↔ [MCP Memory Server] ↔ [SQLite DB (memory.db)]
```

## 3. 기능 범위

### 기억 저장 (remember)
- **입력**: content, type, tags, importance, privacy_scope
- **출력**: memory_id
- **동작**: 텍스트를 DB에 저장하고, 임베딩 생성 후 벡터 컬럼에 기록

### 기억 검색 (recall)
- **입력**: query, filters(type, tags, date), limit
- **출력**: 관련 기억 목록
- **동작**: FTS5(키워드) + VSS(벡터 검색) 결합

### 기억 삭제 (forget)
- **소프트 삭제**: TTL 만료 시 자동 제거
- **하드 삭제**: 사용자가 직접 호출

### 기억 고정/해제 (pin/unpin)
- 특정 기억을 TTL, 망각 정책에서 제외

## 4. 데이터베이스 설계 (SQLite)

### 4.1 메인 테이블

```sql
CREATE TABLE memory_item (
  id TEXT PRIMARY KEY,
  type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
  content TEXT,
  importance REAL,
  privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP,
  pinned BOOLEAN DEFAULT FALSE
);
```

### 4.2 인덱스

#### FTS5 (텍스트 검색)
```sql
CREATE VIRTUAL TABLE memory_item_fts USING fts5(content);
```

#### VSS (벡터 검색, 1536차원 예시)
```sql
CREATE VIRTUAL TABLE memory_item_vss USING vss0(embedding(1536));
```

## 5. MCP 인터페이스 (M1 한정)

### Tools
- `remember(content, type?, tags?, importance?, privacy_scope?)`
- `recall(query, filters?, limit?)`
- `forget(id, hard?)`
- `pin(id)` / `unpin(id)`

### Resources
- `memory/{id}` (단일 기억 읽기)

### Prompts
- `memory_injection(query, token_budget)`
  - 상위 5개 관련 기억을 요약하여 프롬프트에 주입

## 6. 망각 정책

- **작업기억 (working)**: 48시간 유지 후 삭제
- **일화기억 (episodic)**: 90일 유지
- **의미기억 (semantic)**: 무기한
- **고정(pin)**: 삭제 대상에서 제외

주기적으로 실행되는 배치 작업(cron job)으로 만료된 레코드 정리.

## 7. 동작 흐름

### 기억 저장
1. 사용자가 `remember` 호출
2. DB에 기록 → FTS5 인덱스 업데이트 → 임베딩 생성 후 VSS 테이블 기록

### 기억 검색
1. 사용자가 `recall` 호출
2. FTS5로 키워드 검색 → VSS로 벡터 검색 → 점수 합산 → 상위 K개 반환

### 망각/삭제
1. 배치 작업으로 TTL 만료 항목 삭제
2. 사용자가 `forget` 호출 시 즉시 제거

## 8. 운영 및 배포

- **실행 환경**: Node.js (v20 이상)
- **배포 방법**: 로컬 실행
  ```bash
  node memory-server.js
  ```
- **DB 관리**: 단일 memory.db 파일 (로컬 저장소에 보관)
- **백업/복원**: 파일 복사로 처리 가능

## 9. 한계와 다음 단계 고려

**한계**: 단일 사용자 전용, 권한 관리 없음

**확장 고려**:
- M2에서 API Key 인증 추가
- SQLite 서버 모드 전환
- 팀 협업 가능하도록 ACL(user_id, privacy_scope) 활용 예정

## 10. 체크리스트

- [ ] SQLite DB 초기 스키마 생성 완료
- [ ] MCP Tools (remember, recall, forget, pin/unpin) 구현 완료
- [ ] FTS5 + VSS 기반 검색 정상 동작
- [ ] TTL 기반 망각 정책 배치 스크립트 적용
- [ ] 로컬 환경에서 MCP Client와 연동 테스트 완료