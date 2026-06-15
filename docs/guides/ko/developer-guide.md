# 개발자 가이드

Memento는 AI 에이전트를 위한 지능형 메모리 관리 MCP 서버입니다. 이 가이드는 새 기여자가 개발 환경을 구성하고, 코드베이스의 구조를 이해하며, 안정적으로 기여하기 위한 흐름 전반을 설명합니다.

## 사전 요구사항

Memento는 Node.js 24.0.0 이상과 npm 10.0.0 이상을 요구합니다. 이 버전 요건은 TypeScript ES 모듈과 최신 런타임 기능을 활용하기 때문에 더 낮은 버전에서는 빌드 자체가 실패합니다. 개발에는 VS Code를 권장하며, ESLint·Prettier·Vitest 확장과 함께 사용하면 가장 원활합니다.

## 환경 설정

저장소를 클론한 뒤 루트에서 `npm install`을 실행하면 npm workspaces가 모든 패키지의 의존성을 한 번에 설치합니다. 그 다음 환경 변수 파일을 준비합니다.

```bash
git clone https://github.com/your-org/memento.git
cd memento
npm install
cp env.example .env
```

`.env`를 열어 필요한 값을 채운 뒤 데이터베이스를 초기화합니다.

```bash
npm run db:init      # SQLite 스키마 생성
npm run db:migrate   # 보류 중인 마이그레이션 실행
```

이후 개발 서버를 시작합니다. MCP stdio 서버를 띄우려면 `npm run dev`, HTTP 관리 서버를 함께 띄우려면 `npm run dev:http`를 사용합니다. 두 명령은 소스 변경을 감지하여 자동으로 재시작합니다.

## 프로젝트 구조

저장소는 npm workspaces 기반 모노레포입니다. 핵심 구조는 다음과 같습니다.

```
memento/
├── packages/
│   ├── memento-core/       # @memento/core — 도메인·인프라·공유
│   ├── memento-server/     # MCP/HTTP 서버 진입점
│   └── memento-client/     # @memento/client — HTTP 클라이언트 라이브러리
├── apps/
│   └── experimental-example/
├── tests/                  # 루트 통합 테스트
├── scripts/                # 빌드·마이그레이션 유틸리티
├── config/                 # 랭킹 가중치 등 런타임 설정
├── env.example             # 환경 변수 기준 파일
└── AGENTS.md               # 상세 개발·운영 가이드
```

세 패키지의 역할은 명확히 분리되어 있습니다. `memento-core`는 도메인 로직과 인프라를 모두 담으며, `memento-server`는 이를 소비하여 MCP 프로토콜과 HTTP 엔드포인트를 노출합니다. `memento-client`는 외부 프로세스에서 서버에 연결할 때 쓰는 클라이언트 라이브러리입니다.

## 아키텍처 원칙

Memento의 아키텍처는 "Functional Core, Structured Shell" 원칙을 따릅니다. 도메인 로직은 `memento-core`의 순수 함수와 서비스로 구현되고, 서버 레이어는 이를 조합하여 외부에 노출할 뿐입니다. 의존성은 항상 shared → domains → infrastructure 방향으로 흐르며, 역방향 의존을 도입하면 안 됩니다.

### 도메인 구조

`packages/memento-core/src/domains/`는 기능별로 분리된 도메인들로 구성됩니다. 각 도메인은 내부적으로 `services/`, `tools/`, `algorithms/` 등 하위 디렉터리를 가집니다.

| 도메인 | 역할 |
|--------|------|
| memory/ | 저장(remember), 검색(recall), 고정(pin), 망각(forget), 절차 기억 |
| search/ | 하이브리드 검색 (FTS5 + 벡터) |
| embedding/ | 다중 임베딩 프로바이더 (tfidf, minilm, openai, gemini) |
| forgetting/ | TTL 정책 + 스페이스드 리피티션 |
| anchor/ | A/B/C 슬롯 앵커 기반 컨텍스트 검색 |
| relation/ | 관계 추출 (LLM + 규칙 기반) + 트리플 추출 |
| consolidation/ | sleep consolidation (episodic → semantic 증류) |
| telemetry/ | 텔레메트리 수집 |
| monitoring/ | 성능 모니터링·품질 보증 |
| personal-agent/ | personal knowledge agent CLI |
| agent-integration/ | 에이전트 세션 관리·프로버넌스 |

### 검색 랭킹

recall과 하이브리드 검색의 최종 점수는 다음 공식으로 계산됩니다.

```
S = α·relevance + β·recency + γ·importance + δ·usage
    + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
```

가중치 기본값(α=0.45, β=0.20, γ=0.20, δ=0.10 등)은 `config/ranking-weights.toml`에 있으며, 벤치마크 기반으로 조정할 수 있습니다(검색 품질 튜닝 가이드 참고).

## 빌드 시스템

빌드는 core → server → client 순서로 진행되어야 합니다. `npm run build`를 루트에서 실행하면 이 순서가 자동으로 보장됩니다. 개별 패키지만 빌드할 때는 `-w` 플래그를 사용합니다.

```bash
npm run build                    # 전체 빌드 (권장)
npm run build -w @memento/core   # core만 빌드
npm run type-check               # 타입 검사 (빌드 없이)
npm run lint                     # ESLint 검사
```

### no-console 규칙

MCP 서버는 stdio 전송 시 stdout에 JSON-RPC 메시지만 출력해야 하므로, 프로젝트 전체에 `no-console` ESLint 규칙이 error 레벨로 설정되어 있습니다. 모든 로그는 `packages/memento-core/src/shared/utils/logger.ts`의 중앙화된 logger를 통해 출력해야 합니다. 이 logger는 PII를 자동으로 마스킹하고, MCP 컨텍스트에서는 `notifications/message` 형식으로 로그를 전송합니다.

```typescript
// console.log/error 직접 사용 금지
// 대신 아래처럼 사용합니다
import { logger } from '../shared/utils/logger.js';

logger.info('작업 완료', { duration: queryTime, resultCount: results.length });
logger.error('작업 실패', { error: error.message, operation: 'search' });
```

예외는 `packages/memento-server/src/server/index.ts`(MCP 프로토콜 준수), 테스트 파일(`**/*.spec.ts`), 스크립트(`scripts/**`)에만 적용됩니다.

## 테스트 워크플로우

테스트는 Vitest 기반이며 `**/*.spec.ts` 패턴을 따릅니다. 단위 테스트는 각 도메인 폴더 내 `__tests__/` 하위에 위치합니다. 시나리오·벤치마크용 스크립트(`test-*.ts`)는 `packages/memento-core/src/test/`에 있으며 tsx로 실행합니다.

```bash
npm test                   # 전체 테스트 (Vitest)
npm run test:search        # 검색 시나리오 테스트
npm run test -- --coverage # 커버리지 포함
npm run test -- --watch    # 감시 모드
```

테스트를 작성할 때는 AAA(Arrange-Act-Assert) 패턴을 따릅니다. 외부 의존성은 mock 객체로 대체하고, 테스트 픽스처는 `tests/fixtures/`에 모아 관리합니다.

## 개발 워크플로우

새 기능은 반드시 별도 브랜치에서 개발합니다. 커밋 메시지는 Conventional Commits 형식을 따릅니다.

```bash
git checkout -b feature/your-feature

# 개발 진행
npm run dev

# 변경사항 검증
npm test
npm run lint
npm run type-check

# 커밋
git commit -m "feat(tools): add new tool"
git push origin feature/your-feature
```

### 커밋 타입

| 타입 | 용도 |
|------|------|
| feat | 새 기능 |
| fix | 버그 수정 |
| docs | 문서 변경 |
| refactor | 리팩토링 |
| test | 테스트 추가·수정 |
| chore | 빌드·도구 변경 |

## HTTP 보안 (운영자 체크리스트)

HTTP 서버를 원격에서 접근 가능하게 배포할 때는 다음 항목을 확인합니다.

HTTP 라우트는 신뢰 경계를 분리합니다. `/admin`, `/api`는 `/auth/session`에서 시작한 브라우저 세션이 필요합니다. `/api/v1/quality`, `/tools`, `/mcp`, `/messages`는 `Authorization: Bearer` 또는 `X-API-Key`를 사용하는 헤더 기반 프로그램용 표면입니다.

| 항목 | 환경 변수 | 설명 |
|------|-----------|------|
| 브라우저 세션 | `ADMIN_API_KEY` | 프로덕션 필수. `/auth/session`에서 키를 HTTP-only 세션 쿠키로 교환합니다. |
| 헤더 기반 API | `ADMIN_API_KEY` | 프로그램 호출은 Bearer 또는 API-Key 헤더로 인증합니다. |
| 바인딩 | `MEMENTO_HTTP_BIND_HOST` | 기본 `127.0.0.1`. 비루프백 주소로 설정 시 키가 없으면 기동을 거부합니다. |
| CORS | `CORS_ALLOWED_ORIGINS` | 쉼표 구분. 비우면 크로스 오리진 요청을 차단합니다. |
| 무키 기동 (비권장) | `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` | 로컬 개발 전용. 프로덕션에서 절대 사용하지 마십시오. |

자세한 절차는 `env.example` 주석과 `AGENTS.md`를 참고하십시오.

## 추가 참고 자료

- `AGENTS.md` — 프로젝트 마스터 가이드 (아키텍처, 커맨드, 운영 절차)
- `docs/guides/ko/migration-system-guide.md` — 마이그레이션 시스템
- `docs/guides/ko/sdd-workflow.md` — SPECIFY → PLAN → 구현 워크플로우
- `docs/guides/ko/environment-variable-governance.md` — 환경 변수 거버넌스
