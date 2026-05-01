# Memento Agent Guidelines (Master Guide)

이 파일은 Memento 저장소에서 작업하는 모든 AI 에이전트(Gemini, Claude 등)와 개발자를 위한 통합 가이드라인입니다. `CLAUDE.md`와 `GEMINI.md`의 내용을 모두 포함하고 있으며, 이 저장소의 근본적인 명령(Foundational Mandates)으로 간주됩니다.

## 1. 프로젝트 개요 (Project Overview)

Memento는 AI 에이전트를 위한 지능형 메모리 관리 시스템으로, 인간의 메모리 구조를 모델링한 MCP(Model Context Protocol) 서버입니다.
- **메모리 유형**: Working (48h TTL), Episodic (90d TTL), Semantic (∞), Procedural (∞).
- **기술 스택**: Node.js (≥24), TypeScript, SQLite (better-sqlite3), Vitest.
- **핵심 기능**: 하이브리드 검색(FTS5 + Vector), 망각 정책(Forgetting Policies), 성능 모니터링, 다중 임베딩 프로바이더.

## 2. 프로젝트 구조 및 아키텍처 (Architecture)

루트는 npm workspaces 기반의 모노레포 구조입니다.

### 패키지 구성
- **packages/memento-core** (`@memento/core`): 모든 도메인 로직, DB, 서비스가 포함된 핵심 라이브러리.
- **packages/memento-server**: MCP stdio 및 HTTP 관리 서버. core를 소비함.
- **packages/memento-client** (`@memento/client`): 서버 연결용 클라이언트 라이브러리.
- **apps/experimental-example**: core를 in-process로 사용하는 데모 앱.

### 도메인 구조 (memento-core/src/domains/)
- `memory/`: 저장(remember), 검색(recall), 고정(pin), 망각(forget).
- `search/`: 하이브리드 검색 및 랭킹 엔진.
- `embedding/`: 다중 프로바이더 지원 (TF-IDF, MiniLM, OpenAI, Gemini).
- `forgetting/`: TTL 정책 및 데이터 정리.
- `anchor/`: 컨텍스트 앵커 (A/B/C 슬롯) 기반 검색.
- `relation/`: 메모리 관계 추출 및 시각화.
- `procedural/`: 버전 관리가 가능한 절차적 메모리.

## 3. 주요 명령어 (Commands)

### 설정 및 빌드
```bash
npm install          # 의존성 설치
npm run build        # 전체 빌드 (core → server → client)
npm run db:init      # SQLite 스키마 초기화
npm run db:migrate   # 보류 중인 마이그레이션 실행
```

### 개발 및 실행
```bash
npm run dev          # MCP 서버 실행 (Watch 모드)
npm run dev:http     # HTTP 관리 서버 실행 (Watch 모드)
npm run start        # 컴파일된 서버 실행
```

### 테스트 및 품질 관리
```bash
npm test             # 전체 테스트 실행
npm run lint         # 린트 체크
npm run type-check   # 타입 체크
npm run test:search  # 검색 시나리오 테스트
```

## 4. 개발 규칙 및 코딩 스타일 (Development Guidelines)

모든 코딩 표준, 아키텍처 원칙, 스타일 가이드는 **[DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)**에 정의되어 있습니다. 에이전트와 개발자는 작업 시작 전 이 문서를 반드시 숙지해야 합니다.

- **핵심 원칙**: Functional Core, Structured Shell
- **의존성 방향**: shared ← domains ← infrastructure
- **품질 게이트**: 커밋 전 `lint`, `type-check`, `test` 통과 필수.

## 5. 검색 랭킹 공식 (Search Ranking Formula)

검색 결과는 다음과 같은 가중치 공식을 통해 정렬됩니다 (`config/ranking-weights.toml` 참조):
```
S = α·relevance + β·recency + γ·importance + δ·usage + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
(α=0.45, β=0.20, γ=0.20, δ=0.10, ζ=0.15, ζ_fb=0.05, ε=0.10)
```

## 6. 에이전트 전용 지침 (Specialized Agent Instructions)

에이전트의 도구 사용법 및 지식 관리 절차는 **[DEVELOPMENT_RULES.md#4-ai-에이전트-전용-지침-specialized-agent-rules](./DEVELOPMENT_RULES.md#4-ai-에이전트-전용-지침-specialized-agent-rules)**를 참조하십시오.

- **MCP 사용**: 작업 전 `recall`, 작업 후 `remember`.
- **Serena 활용**: 심볼 기반의 효율적 코드 탐색.
- **graphify 분석 우선**: 코드베이스 구조나 아키텍처 관련 질문에 답하기 전 `graphify-out/GRAPH_REPORT.md`를 먼저 확인하고, `graphify-out/wiki/index.md`가 있으면 원시 파일보다 우선 탐색합니다.
- **graphify 갱신**: 코드 수정 후 반드시 지식 그래프를 재빌드합니다.
- **Design System (Dashboard)**: 웹 대시보드 UI 수정 시 `static/css/tokens.css`의 토큰을 우선적으로 사용하며, 리터럴 값 사용을 지양합니다. ([DESIGN.md](./docs/DESIGN.md) 참조)
- **UI 수정 시 토큰 우선 사용**: 새로운 스타일이나 컴포넌트를 추가할 때 항상 디자인 토큰을 기반으로 구현하세요.

## 7. 최근 변경 사항 및 활성 기술
- **016-env-config-cleanup**: 환경 설정 파일 및 문서 정리.
- **005-sleep-consolidation**: 에피소딕 → 시맨틱 오프라인 증류 서비스 추가.
- **011-docker-security-hardening**: 보안 강화 및 Helmet.js 적용.
