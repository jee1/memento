# 사용자 매뉴얼

Memento는 AI 에이전트가 대화와 작업 사이에서 정보를 기억하고 검색할 수 있도록 설계된 MCP(Model Context Protocol) 서버입니다. 에이전트는 중요한 결정, 기술 지식, 진행 중인 작업 컨텍스트를 Memento에 저장해 두고, 이후 세션에서 `recall`이나 `memory_injection`으로 불러와 연속성 있는 작업을 이어갈 수 있습니다.

이 매뉴얼은 Memento를 처음 설치하는 사용자부터 HTTP 클라이언트로 통합하는 개발자까지 모두를 대상으로 합니다. 아래 **시작하기**에서 설치와 MCP 연결을 마친 뒤, 이후 절에서 기억 타입·도구·대시보드를 순서대로 익히면 됩니다.

## 시작하기

역할에 맞는 경로를 고르세요. 자세한 설치는 [INSTALL.md](../../../INSTALL.md)를 참고해 주세요.

**일반 사용 (권장):** Cursor·Claude Desktop 등에서는 `npx`로 MCP에 붙입니다. 설정 예시는 아래 «MCP 클라이언트 연결»과 [Cursor MCP 설정 가이드](./cursor-mcp-setup.md)를 보세요.

**기여·디버깅:** 소스를 클론해 빌드합니다.

```bash
git clone https://github.com/jee1/memento.git
cd memento
npm install
cp env.example .env   # 선택 — 기본값으로도 동작
npm run db:init
npm run build
npm run dev           # MCP stdio (핫 리로드)
```

**운영·Docker:**

```bash
npm run docker:dev    # 또는 npm run docker:prod
# 동등: docker compose -p memento -f docker/docker-compose.dev.yml up -d
curl http://localhost:9001/health   # 권장 프로필 포트. 코드 기본은 3000 — INSTALL «포트» 참고
```

기본으로 MCP `tools/list`에 보이는 도구는 **`recall` · `remember` · `memory_injection` · `feedback` 4개**입니다. 전부 나열하려면 `MEMENTO_TOOLSET=full`을 설정하세요.

### MCP 클라이언트 연결

#### Claude Desktop

Claude Desktop 설정 파일을 열어 Memento 서버를 추가합니다. 일반 사용은 Cursor와 같이 `npx memento-mcp-server@latest`를 권장하고, 아래는 로컬 빌드 경로 예시입니다.

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["path/to/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

설정 후 Claude Desktop을 재시작하면 Memento MCP 도구가 활성화됩니다.

#### Cursor

**일반 사용 (권장):** `npx`로 붙입니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

**기여·디버깅:** 로컬 빌드 후 `packages/memento-server/dist/server/index.js`를 stdio 진입점으로 지정합니다 (`npm install && npm run build`). URL 방식과 혼동하지 마세요.

상세 예시·오류 대응은 [Cursor MCP 설정 가이드](./cursor-mcp-setup.md)를 참고해 주세요. HTTP 서버를 띄운 경우 `http://127.0.0.1:<포트>/mcp`로도 연결할 수 있습니다(권장 프로필 `9001`, 코드 기본 `3000`).

## 기억 저장하기

AI 에이전트와의 대화에서 중요한 정보를 기억으로 저장하는 가장 간단한 방법은 MCP의 `remember` 도구를 호출하는 것입니다. HTTP 서버가 실행 중일 때는 `@jee1/memento-client` 패키지로도 동일하게 저장할 수 있습니다.

HTTP 서버 URL 예시는 권장 프로필 `http://localhost:9001` 기준입니다(코드 기본 포트는 `3000`). `MCP_SERVER_PORT` / `PORT`로 바꿀 수 있습니다. 개발 중에는 `npm run dev:http`로 시작하세요. 자세한 구분은 [INSTALL.md](../../../INSTALL.md) «포트»를 참고해 주세요.

```typescript
import { MementoClient } from '@jee1/memento-client';

const client = new MementoClient({
  serverUrl: 'http://localhost:9001',
});

await client.connect();

// type은 필수입니다 (생략하면 거절)
await client.remember({
  content: '사용자가 React Hook에 대해 질문했고, useState와 useEffect의 차이점을 설명했다.',
  type: 'episodic',
});

await client.remember({
  content: '프로젝트에서 TypeScript를 도입하기로 결정했다.',
  type: 'episodic',
  tags: ['typescript', 'decision', 'project'],
  importance: 0.8,
});

await client.remember({
  content: 'React Hook 사용법 요약',
  type: 'semantic',
  tags: ['react', 'hooks', 'programming'],
});
```

CLI를 선호하는 경우에도 동일하게 저장할 수 있습니다.

```bash
memento remember "React Hook 사용법" --type semantic --tags "react,hooks,programming"
```

CLI 사용법 전반은 [Memento CLI for AI 가이드](./memento-cli-for-ai.md)를 참고하세요.

## 기억 타입 이해하기

Memento는 저장 목적에 따라 네 가지 기억 타입을 구분합니다. 타입을 올바르게 지정하면 기억의 수명과 자동 삭제 주기가 결정됩니다.

**작업기억(working)**은 현재 처리 중인 임시 컨텍스트를 위한 것입니다. 48시간이 지나면 자동으로 삭제되므로, 진행 중인 버그 수정 내용이나 임시 메모 등을 저장하기에 적합합니다.

**일화기억(episodic)**은 사건과 경험을 기록합니다. 회의 결정 사항, 작업 완료 기록, 프로젝트 진행 상황 등을 저장하며, 고정(pin)하지 않으면 90일 후 자동 삭제됩니다.

**의미기억(semantic)**은 기술 지식, 가이드라인, 규칙 등 반영구적으로 보존해야 할 지식을 위한 타입입니다. 별도로 삭제하지 않는 한 유지됩니다.

**절차기억(procedural)**은 작업 절차, 배포 방법, 반복적인 문제 해결 과정 등을 저장합니다. 의미기억과 마찬가지로 무기한 보존됩니다.

```bash
# 작업기억 — 짧은 컨텍스트 유지
memento remember "현재 작업 중인 버그 수정 내용" --type working

# 일화기억 — 경험 기록
memento remember "오늘 회의에서 결정된 사항들" --type episodic --tags "meeting,decision"

# 의미기억 — 지식 축적
memento remember "React Hook의 기본 개념과 사용법" --type semantic --tags "react,hooks"

# 절차기억 — 절차 문서화
memento remember "Docker 컨테이너 배포 절차" --type procedural --tags "docker,deployment"
```

## 기억 검색하기

저장된 기억을 찾을 때 Memento는 FTS5 전문 검색과 벡터 유사도 검색을 결합한 하이브리드 검색을 사용합니다. 이 방식 덕분에 키워드가 정확히 일치하지 않아도 의미적으로 관련된 기억을 찾을 수 있습니다.

```typescript
// 기본 하이브리드 검색
const result = await client.hybridSearch({
  query: 'React Hook 사용법',
});

// 벡터 검색 비중을 높여 의미 기반 검색 강화
const tuned = await client.hybridSearch({
  query: 'TypeScript 인터페이스',
  vectorWeight: 0.8,
  textWeight: 0.2,
});
```

CLI에서는 `recall` 명령으로 검색합니다.

```bash
# 기본 검색 (--type 필수)
memento recall --query "React Hook" --type episodic --limit 5

# 타입과 태그로 좁히기
memento recall --query "TypeScript" --type semantic --tags "programming" --limit 10
```

검색 결과에는 `score`(관련성 점수)와 `recall_reason`(검색된 이유)이 포함되어 어떤 근거로 해당 기억이 반환되었는지 파악할 수 있습니다.

### 임베딩 설정

기본적으로 Memento는 MiniLM 임베딩을 사용합니다. 더 높은 품질의 임베딩이 필요하다면 OpenAI나 Gemini 제공자로 전환할 수 있습니다. `EMBEDDING_PROVIDER` 환경 변수로 제공자를 선택하며, 지원 값은 `tfidf`, `lightweight`, `minilm`, `openai`, `gemini`입니다.

```bash
# .env 파일에 추가
EMBEDDING_PROVIDER=minilm      # 기본값 — API 키 불필요
# EMBEDDING_PROVIDER=openai    # 고품질, API 키 필요
OPENAI_API_KEY=your_key_here
# EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

의미 기반 검색을 활용하면 "자동차"로 검색해도 "차량"이라는 단어가 들어간 기억을 찾을 수 있고, "프로그래밍"으로 검색하면 "코딩"과 관련된 기억도 반환됩니다.

## HTTP 대시보드 — 상태 (첫 화면)

`/dashboard`에 로그인하면 첫 화면은 **상태** 탭이다. 「정상인가 / 제 일을 하고 있나 / 손댈 것」 세 구역이 `/admin/ops/summary` 의 `zones` 를 보여 준다. 색은 서버가 준 경보만 쓰고, 새로고침은 수동이다.

구역 아래의 **임베딩 상태** 카드는 고른 제공자(기본 `minilm`, 구역의 임베딩 행과 같은 건수)의 문제 건수와 커버리지를 보여 준다. 커버리지는 활성 기억 중 임베딩이 있고, 읽히고, 차원과 모델이 맞는 비율이다. 카드는 `GET /admin/embedding-health` 를 직접 부른다. 문제가 0건이면 조치가 필요 없다고 알려 주고, 문제가 있으면 종류별 조치와 대상을 먼저 확인하는 명령 `npm run reindex-embeddings -- --provider <provider> --dry-run` 을 보여 준다. **상세와 용어**를 펼치면 종류별 건수(누락, 읽기 불가/손상, 차원 불일치, 제공자 드리프트, 모델 드리프트)와 정의가 나온다. 건수를 누르면 해당 기억 목록이, 목록의 ID 를 누르면 기억 찾기 탭에서 그 기억이 열린다.

## HTTP 대시보드 — 앵커 맵

`/dashboard`의 **앵커 맵** 탭에서 슬롯 A/B/C 앵커와 주변 기억을 본다. 기억 노드는 가장 가까운 소속 앵커 색으로 채워지고, hop이 멀수록 옅어지며, 두 앵커 이상이면 테두리가 두 번째 앵커 색이다. 라벨·hover·상세에 슬롯 문자가 같이 나온다. API 필드 `anchors`와 색 규칙은 [앵커 연결 확인](./how-to-check-anchor-connections.md)을 본다.

## HTTP 대시보드 — Memory Graph

`/dashboard`의 Memory Graph 탭(또는 `/graph`)에서 기억·관계 노드를 본다. 「전체 로드」는 최대 5,000개까지 요청한다. 레이아웃이 안정되면 화면이 노드 bbox 에 두 번(tick 100, 시뮬 end) 맞춰지고, 툴바 **전체 보기**로 같은 맞춤을 다시 할 수 있다. 휠로 더 줄일 수 있는 하한은 그래프 크기에 따라 `0.1` 아래로 내려가기도 한다. 배율이 낮으면(`k < 0.4`) 노드 라벨만 숨고, 원에 마우스를 올리면 툴팁은 그대로 보인다. API 파라미터는 [관계 그래프 API](../../api/ko/relation-graph-api.md)의 `GET /admin/graph` 절을 본다.

## HTTP 대시보드 — 배치 작업 탭

`npm run dev:http`로 HTTP 관리 서버를 켠 뒤 `/dashboard`에 로그인하면 **배치 작업** 탭에서 스케줄 표, 큐, durable 실행 이력을 볼 수 있습니다. **새로고침**을 누르면 `GET /admin/batch/stats`가 각 작업의 간격·상태와 함께 **`description`**(한글 역할 요약)을 내려주며, 스케줄 표 작업명 아래, 행 선택 시 오른쪽 드로어, 탭 상단 **이건 뭔가요** 목록이 같은 문자열을 씁니다. 설명 원본은 `@memento/core`의 `batch-scheduler-job-descriptions.ts` 한 곳입니다.

## HTTP 대시보드 — 설정 탭

**설정** 탭은 기능 플래그와 운영 손잡이 13개를 재기동 없이 바꿉니다. 표에서 키마다 설명, 실효값, 출처 배지(DB, .env, 기본값), 코드 기본값, 위험도, 반영 방식(즉시 또는 재기동 필요), 마지막 변경(누가, 언제)을 봅니다. DB 값이 있거나 기본값과 다른 행에는 **기본값과 다름**이 붙습니다. 상위 스위치 때문에 코드가 지금 읽지 않는 값(관계 추출 제공자가 typesafe일 때의 `LLM_MODEL_RELATION_EXTRACTION`, 검색 기각 게이트가 off, ollama 이거나 typesafe 인데 `TYPESAFE_API_KEY` 가 비어 있을 때의 게이트 임계값 3개, 판정기가 off 이거나 키가 비어 있을 때의 `CONSOLIDATION_JUDGE_THRESHOLD`)은 키 설명 아래에 **적용 안 됨** 배지와 이유가 붙습니다. 값은 지워지지 않아 상위 스위치를 켜면 다시 쓰입니다. **변경**을 누르면 기존 값과 새 값을 보여 주는 확인 창이 열리고, 사유를 적어야 저장됩니다. 위험도가 중간 이상이면 강조 문구가 붙고, 재기동 키는 재기동 뒤에 반영된다고 알려 줍니다. DB 값이 있는 행의 **되돌리기**도 같은 확인 창과 사유를 거칩니다. 아래쪽 변경 이력 표는 키별로 거를 수 있습니다. 비밀값, 인프라, 임베딩 모델은 읽기 전용 목록에 키와 설정 여부만 보입니다. 비밀값 원문은 화면에 내려오지 않습니다.

## 기억 관리하기

### 고정과 고정 해제

중요한 기억이 TTL에 의해 자동 삭제되지 않도록 보호하려면 `pin` 도구를 사용합니다.

```bash
memento remember "핵심 아키텍처 결정 사항" --type episodic --tags "architecture,important"
# 반환된 memory_id로 고정
# MCP 도구: pin(memoryId)
```

`@jee1/memento-client`에서는 `client.pin(memoryId)` / `client.unpin(memoryId)`로 고정하고 해제합니다.

### 기억 삭제

기억을 삭제할 때는 소프트 삭제(복구 가능)와 하드 삭제(복구 불가능) 중 선택할 수 있습니다.

```bash
# 소프트 삭제
memento forget --id mem_xxxxx

# 하드 삭제 — 복구 불가
memento forget --id mem_xxxxx --hard --confirm true
```

`@jee1/memento-client`에서는 `client.forget(memoryId, hard)` 형태로 호출합니다.

### 피드백 제공

검색 결과의 유용성에 대한 피드백을 제공하면 이후 검색 품질 개선에 반영됩니다. MCP 도구 `feedback`을 사용하거나 `client.feedback(...)` 메서드를 호출합니다.

## 태그 활용하기

태그는 기억을 구조화하고 필터링하는 핵심 수단입니다. 일관된 태그 체계를 사용하면 관련 기억을 정확하게 찾을 수 있습니다.

권장 태그 분류는 다음과 같습니다.

- **언어/기술**: `javascript`, `typescript`, `react`, `docker`
- **카테고리**: `programming`, `design`, `meeting`, `decision`
- **상태**: `todo`, `in-progress`, `completed`, `blocked`
- **중요도**: `critical`, `important`, `nice-to-have`

여러 프로젝트의 기억을 분리하려면 프로젝트별 태그를 일관되게 붙이는 것이 가장 간단한 방법입니다.

```bash
memento remember "프로젝트 A 아키텍처 결정" --type episodic --tags "project-a,architecture,decision"
memento recall --query "아키텍처" --type episodic --tags "project-a"
```

## 관계 그래프

기억들 사이에 관계를 설정하면 관련 기억을 따라가며 더 풍부한 컨텍스트를 얻을 수 있습니다. MCP 도구 `add_relation`을 사용해 두 기억을 연결하고, `get_relations`로 연결된 기억 목록을 확인합니다. `get_memory_neighbors`는 특정 기억에서 연결된 이웃 기억을 함께 조회합니다.

자세한 내용은 [관계 레이블링 가이드](./relation-labeling-guide.md)를 참고하세요.

## 문제 해결

### 서버에 연결할 수 없을 때

MCP 클라이언트가 서버에 연결하지 못하는 경우, 먼저 서버가 실행 중인지 확인합니다. stdio 방식이라면 `node packages/memento-server/dist/server/index.js`를 직접 실행해보고, HTTP 방식이라면 `curl http://localhost:9001/health`로 응답을 확인합니다. HTTP 포트는 권장 프로필 `9001`(코드 기본 `3000`)이며 `MCP_SERVER_PORT`로 변경할 수 있습니다.

빌드 산출물이 없다면 `npm run build`를 먼저 실행하세요. 빌드 후 `packages/memento-server/dist/server/index.js`가 생성됩니다.

### 검색 결과가 나오지 않을 때

쿼리 키워드를 바꿔보거나 타입/태그 필터를 완화해 재시도합니다. 해당 기억이 실제로 저장되었는지 먼저 확인하는 것도 좋습니다. 임베딩 제공자 설정이 저장 시점과 검색 시점 사이에 변경된 경우 의미 검색 결과가 달라질 수 있습니다.

### 로그 확인

로컬 개발 중에는 `npm run dev` 터미널 출력에서 로그를 확인합니다. 마이그레이션 또는 DB 상태가 의심되면 `npm run db:check-migration`을 실행하세요.

Docker 환경에서는 다음 명령으로 로그를 확인합니다.

```bash
docker compose -f docker/docker-compose.dev.yml logs -f
docker compose -f docker/docker-compose.dev.yml ps
```

## FAQ

**기억이 자동으로 삭제되나요?**

타입에 따라 다릅니다. 작업기억은 48시간, 일화기억은 90일 후 자동 삭제됩니다. 의미기억과 절차기억은 삭제하지 않는 한 유지됩니다. `pin`으로 고정한 기억은 타입에 상관없이 자동 삭제되지 않습니다.

**기억을 영구적으로 보존하려면 어떻게 하나요?**

`pin` MCP 도구 또는 `client.pin(memoryId)`로 기억을 고정하면 TTL 삭제에서 제외됩니다.

**검색 정확도를 높이려면 어떻게 해야 하나요?**

구체적인 키워드를 포함한 쿼리를 사용하고, 저장 시 관련 태그를 충분히 붙여두세요. `feedback` 도구로 검색 결과의 유용성을 신호로 전달하면 검색 품질 개선에 도움이 됩니다. 의미 검색 품질을 높이려면 MiniLM 이상의 임베딩 제공자를 사용하는 것이 좋습니다.

**데이터베이스는 어디에 저장되나요?**

기본 위치는 `~/.memento/memory.db`입니다. `DB_PATH` 환경 변수나 `--db-path` 옵션으로 경로를 변경할 수 있습니다. 절대 경로를 사용하는 것을 권장합니다.

## 추가 리소스

- [API 참조 문서](../../api/ko/api-reference.md)
- [개발자 가이드](developer-guide.md)
- [Memento CLI for AI 가이드](./memento-cli-for-ai.md)
- [Cursor MCP 설정 가이드](./cursor-mcp-setup.md)
- [npx 실행 문제 해결](../../operations/ko/npx-troubleshooting.md)
- [Node 버전 호환성](../../operations/ko/troubleshooting-node-version.md)
- [GitHub 저장소](https://github.com/jee1/memento)
