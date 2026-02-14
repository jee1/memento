# 📄 MCP Memory Server 설계 및 마일스톤 문서
## 🎯 비전

사람의 기억 구조(작업기억·일화기억·의미기억)를 모방한 AI Agent 기억 보조 MCP 서버를 구현한다.

- 개인(MVP): 단일 SQLite 파일 기반, 로컬에서 가볍게 실행
- 팀: 내부망 전용 서버 + 단일 API Key, SQLite + 직렬화 큐
- 조직: Postgres + pgvector + JWT 인증, SSO/LDAP 연동

## 🛠 마일스톤 개요

| 단계 | 대상 | 스토리지 | 인증 | 보안 범위 | 운영 방식 |
|------|------|----------|------|-----------|-----------|
| M1 | 개인 | SQLite 임베디드 | 없음 | 로컬 | 로컬 실행 |
| M2 | 팀 | SQLite 서버 모드 (WAL + 직렬화 큐) | 단일 API Key | 내부망 전용 | Docker 단일 컨테이너 |
| M3 | 조직 초입 | Postgres + pgvector | JWT (사용자별 토큰) | 내부망 or VPN | Docker Compose (서버+DB) |
| M4 | 조직 확장 | Postgres + HA 구성 | JWT + RBAC + SSO/LDAP | 기업 보안 정책 준수 | Kubernetes/클라우드 RDS |
## ⚙️ 단계별 설계

### 🔹 M1. 개인용 (MVP)

- **DB**: SQLite (memory.db)
- **인덱스**: FTS5, sqlite-vec (벡터 검색)
- **MCP Tools**: remember, recall, forget, pin
- **망각 정책**: TTL 기반 (working 48h, episodic 90d, semantic 무기한)
- **운영**: 로컬 실행 (node memory-server.js)

### 🔹 M2. 팀 협업 (내부망 전용 서버)

- **DB**: SQLite (WAL 모드)
- **쓰기 처리**: 서버 레벨 큐잉 → 직렬화
- **읽기 처리**: 다중 동시 읽기 가능
- **인증**: 단일 API Key (API_KEY=team-secret-key)
- **보안**: 내부망 전용 (외부 포트 차단)
- **운영**: Docker 단일 컨테이너

```yaml
services:
  memory-server:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      - DB_PATH=/app/data/memory.db
      - API_KEY=team-secret-key
```

- **ACL**: privacy_scope (private | team) 적용

### 🔹 M3. 조직 초입 (Postgres 전환)

- **DB**: Postgres 15+, pgvector 확장

**스키마**:

```sql
CREATE TABLE memory_item (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
  content TEXT,
  importance REAL,
  privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_accessed TIMESTAMPTZ,
  embedding vector(1536),
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX ON memory_item USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON memory_item USING GIN (content_tsv);
```

- **인증**: JWT 기반 사용자별 토큰 (user_id claim 포함)
- **보안**: 내부망 or VPN 제한
- **운영**: Docker Compose (Memory Server + Postgres)

### 🔹 M4. 조직 확장 (고가용성 + 기업 보안)

- **DB**: Postgres 클러스터 (HA 구성, 클라우드 RDS 가능)
- **인증**: JWT + RBAC + SSO/LDAP 연동
- **권한 모델**:
  - privacy_scope: private/team/public
  - project_id: 워크스페이스 단위
  - RBAC(Role-Based Access Control) → 관리자/편집자/조회자
- **운영**: Kubernetes, Helm Chart 배포, 모니터링(Prometheus)
- **추가 기능**: 자동 아카이빙, 백업/복원, GDPR-style 삭제

## 📦 MCP 인터페이스 (공통)

### Tools

- `remember(content, type, tags?, importance?, privacy_scope?)`
- `recall(query, filters?, limit?)`
- `pin(id), unpin(id)`
- `forget(id, hard?)`
- `summarize_thread(session_id)`
- `link(src, dst, rel)`
- `export(format)`
- `feedback(memory_id, helpful?)`

### Resources

- `memory/{id}`
- `memory/search?query=...`

### Prompts

- `memory_injection(query, token_budget)` → 상위 K개 관련 기억 요약 주입

## 🔐 보안 모델 정리

- **M1**: 없음 (로컬 전용)
- **M2**: 단일 API Key (팀 공유)
- **M3**: JWT (사용자별 토큰, 조직 계정 서버 연동 가능)
- **M4**: JWT + RBAC + SSO/LDAP → 기업 보안 정책 준수

## 📑 마이그레이션 가이드 요약

1. SQLite에서 memory_item.csv 추출
2. Postgres에 스키마 생성 (pgvector, tsvector)
3. CSV import → `\copy`
4. embedding은 재계산 후 업데이트
5. MCP Memory Server의 DB 드라이버만 교체

## ✅ 체크리스트

- [ ] 개인용 SQLite 서버 완성
- [ ] 팀 단계 Docker 배포 + API Key 적용
- [ ] Postgres 마이그레이션 문서 완성
- [ ] 조직 단계 JWT 인증 연동
- [ ] SSO/LDAP 붙이는 로드맵 확정