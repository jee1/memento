# 사용자 매뉴얼

## 개요

이 매뉴얼은 Memento MCP Server를 사용하여 AI Agent의 기억을 관리하는 방법을 설명합니다. 초보자부터 고급 사용자까지 모든 수준의 사용자를 대상으로 합니다.

## 목차

1. [시작하기](#시작하기)
2. [기본 사용법](#기본-사용법)
3. [고급 기능](#고급-기능)
4. [문제 해결](#문제-해결)
5. [FAQ](#faq)

## 시작하기

### 설치

#### M1 (개인용) - 로컬 설치

```bash
# 저장소 클론
git clone https://github.com/jee1/memento.git
cd memento

# 의존성 설치
npm install

# 환경 변수 설정
cp env.example .env
# .env 파일을 편집하여 필요한 설정을 입력하세요

# 데이터베이스 초기화
npm run db:init

# 서버 시작 (핫 리로드)
npm run dev
```

#### M2 (팀용) - Docker 설치

```bash
# Docker Compose로 실행
docker-compose up -d

# 서버 상태 확인
curl http://localhost:9001/health
```

### MCP 클라이언트 설정

#### Claude Desktop 설정

1. Claude Desktop 설정 파일을 열기:
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. MCP 서버 추가:
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

3. Claude Desktop 재시작

#### Cursor 설정

Cursor에서 Memento는 보통 **stdio MCP**로 붙입니다(로컬에서 `node`가 `packages/memento-server/dist/server/index.js`를 실행). **URL만 입력하는 방식**과 혼동하지 마세요.

1. 저장소 루트에서 `npm install` 후 `npm run build`로 `packages/memento-server/dist/server/index.js`를 생성합니다.
2. Cursor MCP 설정(예: `.cursor/mcp.json`)에 `command` / `args`로 위 진입점을 지정합니다.
3. 예시·오류 대응은 **[Cursor MCP 설정 가이드](./cursor-mcp-setup.md)** 를 따르세요.

HTTP로 MCP를 노출한 경우에 한해, 클라이언트가 지원하면 `http://127.0.0.1:<포트>/mcp` 등으로 연결할 수 있습니다. 기본 권장 흐름은 stdio입니다.

## 기본 사용법

### 1. 기억 저장하기

AI Agent와의 대화에서 중요한 정보를 기억으로 저장할 수 있습니다.

#### `@memento/client` HTTP 클라이언트 예시

HTTP 서버가 실행 중일 때(예: `npm run dev:http`, 기본 `http://localhost:9001`(`PORT`/`MCP_SERVER_PORT` 환경 변수로 변경 가능)) npm 패키지 **`@memento/client`** 로 호출할 수 있습니다.

```typescript
import { MementoClient } from '@memento/client';

const client = new MementoClient({
  serverUrl: 'http://localhost:9001',
});

await client.connect();

// 기본 저장
await client.remember({
  content: '사용자가 React Hook에 대해 질문했고, useState와 useEffect의 차이점을 설명했다.',
});

// 태그·중요도와 함께 저장
await client.remember({
  content: '프로젝트에서 TypeScript를 도입하기로 결정했다.',
  tags: ['typescript', 'decision', 'project'],
  importance: 0.8,
});

// 기억 타입 지정(예: semantic)
await client.remember({
  content: 'React Hook 사용법 요약',
  type: 'semantic',
  tags: ['react', 'hooks', 'programming'],
});
```

CLI(`memento` 등)를 사용하는 경우:

```bash
memento remember "React Hook 사용법" --type semantic --tags "react,hooks,programming"
```

### 2. 기억 검색하기

저장된 기억을 검색하여 관련 정보를 찾을 수 있습니다. Memento는 기본 검색과 하이브리드 검색을 제공합니다.

#### 하이브리드 검색 (권장)

FTS5 텍스트 검색과 벡터 검색을 결합한 하이브리드 검색을 사용하면 더 정확한 결과를 얻을 수 있습니다.

```typescript
// 기본 하이브리드 검색 (가중치는 서버/클라이언트 기본에 따름)
const result = await client.hybridSearch({
  query: 'React Hook 사용법',
});

// 가중치 조정 (벡터 비중 높이기)
const tuned = await client.hybridSearch({
  query: 'TypeScript 인터페이스',
  vectorWeight: 0.8,
  textWeight: 0.2,
});
```

#### 기본 검색

```
@memento recall "React Hook"
```

#### 고급 검색

```
@memento recall "TypeScript" --type "episodic,semantic" --tags "programming" --limit 10
```

#### 시간 범위 검색

```
@memento recall "프로젝트 결정" --from "2024-01-01" --to "2024-12-31"
```

### 3. 임베딩 기능 사용하기

Memento는 4가지 임베딩 제공자를 지원합니다: **TF-IDF**, **MiniLM**, **OpenAI**, **Gemini**. 설정된 우선순위에 따라 자동으로 선택되며, OpenAI API가 없는 경우 자동으로 무료 제공자(TF-IDF 또는 MiniLM)를 사용합니다.

#### 임베딩 기능 설정

1. **OpenAI API 키 설정**:
```bash
# .env 파일에 추가 (선택사항 - 없으면 TF-IDF 또는 MiniLM 임베딩 사용)
OPENAI_API_KEY=your_openai_api_key_here
# 또는 Gemini 사용
GEMINI_API_KEY=your_gemini_api_key_here
# 기본 제공자 선택 (옵션: tfidf, minilm, openai, gemini)
EMBEDDING_PROVIDER=minilm
```

2. **임베딩 서비스 확인**:
```bash
# 임베딩 기능 테스트
npm run test:embedding
```

#### 임베딩 기능의 장점

- **의미적 검색**: 키워드가 아닌 의미를 기반으로 한 검색
- **동의어 인식**: "자동차"와 "차량"을 같은 의미로 인식
- **관련 개념 검색**: "프로그래밍"과 "코딩"을 연관된 개념으로 인식
- **자동 임베딩 생성**: 기억 저장 시 자동으로 벡터 생성

#### 임베딩 검색 사용법

```typescript
// 기억 저장 시 서버가 임베딩을 생성합니다
await client.remember({
  content: 'React Hook에 대한 상세한 설명과 사용 예시',
  type: 'semantic',
  tags: ['react', 'hooks', 'javascript'],
});

// 하이브리드 검색
const searchResult = await client.hybridSearch({
  query: 'React 상태 관리',
  vectorWeight: 0.7,
  textWeight: 0.3,
});
```

### 4. 기억 관리하기

#### 기억 고정하기

중요한 기억을 고정하여 자동 삭제에서 보호할 수 있습니다.

```
@memento pin memory-123
```

#### 기억 고정 해제하기

```
@memento unpin memory-123
```

#### 기억 삭제하기

```
@memento forget memory-123
```

#### 하드 삭제하기

```
@memento forget memory-123 --hard
```

## 고급 기능

### 1. 망각 정책 사용하기

#### 망각 정책이란?

망각 정책은 메모리의 수명을 관리하는 시스템입니다. 인간의 기억 시스템을 모방하여:

- **자동 망각**: 오래되고 사용되지 않는 기억을 자동으로 삭제
- **간격 반복**: 중요한 기억을 주기적으로 리뷰하여 강화
- **TTL 관리**: 메모리 타입별로 다른 수명 정책 적용

#### 망각 정책·배치·간격 반복

TTL·배치 망각·스케줄링은 **서버 스케줄러와 MCP/HTTP admin** 쪽에서 다루는 경우가 많습니다. `@memento/client`가 노출하는 HTTP 메서드는 **`remember` / `recall` / `hybridSearch` / `forget` / `pin` / `unpin` 등** 중심이며, 과거 문서에 있던 `apply_forgetting_policy`·`schedule_review` 같은 가상의 `callTool` 이름과 일치하지 않을 수 있습니다.

개별 기억 삭제는 클라이언트에서 `forget(memoryId, hard)` 형태로 요청할 수 있습니다(서버가 해당 라우트를 노출하는 경우).

운영·자동화 절차는 [API 참조](../../api/ko/api-reference.md)와 [개발자 가이드](developer-guide.md)를 참고하세요.

### 2. HTTP 서버 사용하기

#### HTTP 서버란?

HTTP 서버는 WebSocket을 지원하는 실시간 통신 서버입니다. 웹 클라이언트와의 통신을 위해 설계되었습니다.

#### HTTP 서버 시작

```bash
# HTTP 서버 시작
npm run dev:http

# 또는 직접 실행
node packages/memento-server/dist/server/http-server.js
```

#### WebSocket 연결

```javascript
// 웹 클라이언트에서 WebSocket 연결
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('WebSocket 연결됨');
  
  // MCP 메시지 전송
  ws.send(JSON.stringify({
    method: 'tools/call',
    params: {
      name: 'remember',
      arguments: {
        content: '웹에서 저장한 기억',
        type: 'episodic'
      }
    },
    id: 'web-1'
  }));
});

ws.on('message', (data) => {
  const response = JSON.parse(data);
  console.log('서버 응답:', response);
});
```

### 3. 세션 요약

대화 세션을 요약하여 기억으로 저장할 수 있습니다.

```
@memento summarize_thread session-456 --importance 0.8
```

### 4. 기억 간 관계 생성

기억들 간의 관계를 설정하여 더 나은 검색 결과를 얻을 수 있습니다.

```
@memento link memory-123 memory-456 --relation "derived_from"
```

사용 가능한 관계 타입:
- `cause_of`: 원인 관계
- `derived_from`: 파생 관계
- `duplicates`: 중복 관계
- `contradicts`: 모순 관계

### 5. 기억 내보내기

저장된 기억을 다양한 형식으로 내보낼 수 있습니다.

#### JSON 형식

```
@memento export --format json --type "episodic,semantic"
```

#### CSV 형식

```
@memento export --format csv --tags "programming,react"
```

#### Markdown 형식

```
@memento export --format markdown --from "2024-01-01"
```

### 4. 피드백 제공

기억의 유용성에 대한 피드백을 제공하여 검색 품질을 개선할 수 있습니다.

```
@memento feedback memory-123 --helpful true --comment "매우 유용한 정보였습니다"
```

## 기억 타입별 사용법

### 작업기억 (Working Memory)

현재 처리 중인 정보를 임시로 저장합니다.

```
@memento remember "현재 작업 중인 버그 수정 내용" --type "working"
```

- **특징**: 48시간 후 자동 삭제
- **용도**: 현재 작업 컨텍스트 유지

### 일화기억 (Episodic Memory)

사건과 경험을 저장합니다.

```
@memento remember "오늘 회의에서 결정된 사항들" --type "episodic" --tags "meeting,decision"
```

- **특징**: 90일 후 자동 삭제 (고정하지 않은 경우)
- **용도**: 프로젝트 진행 상황, 회의 내용, 경험

### 의미기억 (Semantic Memory)

지식과 사실을 저장합니다.

```
@memento remember "React Hook의 기본 개념과 사용법" --type "semantic" --tags "react,hooks,knowledge"
```

- **특징**: 무기한 보존
- **용도**: 기술 지식, 가이드라인, 규칙

### 절차기억 (Procedural Memory)

방법과 절차를 저장합니다.

```
@memento remember "Docker 컨테이너 배포 절차" --type "procedural" --tags "docker,deployment,procedure"
```

- **특징**: 무기한 보존
- **용도**: 작업 절차, 설정 방법, 문제 해결 과정

## 태그 시스템

### 태그 명명 규칙

- **언어/기술**: `javascript`, `typescript`, `react`, `docker`
- **카테고리**: `programming`, `design`, `meeting`, `decision`
- **상태**: `todo`, `in-progress`, `completed`, `blocked`
- **중요도**: `critical`, `important`, `nice-to-have`

### 태그 사용 예시

```
@memento remember "프로젝트 아키텍처 설계" --tags "architecture,design,typescript,important"
```

## 검색 팁

### 1. 효과적인 검색 쿼리 작성

- **구체적인 키워드 사용**: "React Hook" > "프로그래밍"
- **동의어 활용**: "JavaScript"와 "JS" 모두 검색
- **문맥 포함**: "프로젝트 설정" > "설정"

### 2. 필터 활용

- **타입 필터**: 특정 기억 타입만 검색
- **태그 필터**: 관련 태그가 있는 기억만 검색
- **시간 필터**: 특정 기간의 기억만 검색

### 3. 검색 결과 해석

- **점수**: 높을수록 관련성이 높음
- **recall_reason**: 검색된 이유 설명
- **태그**: 기억의 분류 정보

## 문제 해결

### 일반적인 문제

#### 1. 연결 오류

**증상**: MCP 서버에 연결할 수 없음

**해결 방법**:
1. 서버가 실행 중인지 확인
2. 포트가 올바른지 확인 (로컬 HTTP 기본: 9001; `docker-compose.dev.yml` 예시는 8080)
3. 방화벽 설정 확인

#### 2. 검색 결과가 없음

**증상**: 검색해도 결과가 나오지 않음

**해결 방법**:
1. 다른 키워드로 시도
2. 필터 조건 완화
3. 기억이 실제로 저장되었는지 확인

#### 3. 메모리 부족

**증상**: 서버 성능 저하, 응답 지연

**해결 방법**:
1. 오래된 기억 정리
2. 불필요한 기억 삭제
3. 서버 리소스 확인

### 로그 확인

#### M1 (로컬)

```bash
# 로컬 개발 서버는 npm run dev 터미널 출력에서 로그 확인

# 마이그레이션·DB 상태 점검
npm run db:check-migration
```

#### M2+ (Docker)

```bash
# 컨테이너 로그 확인
docker-compose logs memento-server

# 컨테이너 상태 확인
docker-compose ps
```

### 성능 최적화

#### 1. 기억 정리

정기적으로 불필요한 기억을 정리하세요:

```bash
# 오래된 작업기억 정리
@memento forget --type "working" --older-than "2 days"

# 중복 기억 정리
@memento cleanup --duplicates
```

#### 2. 인덱스 최적화

```bash
# 검색 인덱스 재구성
@memento optimize --indexes
```

## FAQ

### Q: 기억이 자동으로 삭제되나요?

A: 네, 기억 타입에 따라 자동 삭제됩니다:
- 작업기억: 48시간 후
- 일화기억: 90일 후 (고정하지 않은 경우)
- 의미기억/절차기억: 자동 삭제되지 않음

### Q: 기억을 영구적으로 보존하려면?

A: `pin` 명령어로 기억을 고정하면 자동 삭제에서 제외됩니다:

```
@memento pin memory-123
```

### Q: 검색 결과의 정확도를 높이려면?

A: 다음 방법들을 시도해보세요:
1. 더 구체적인 검색 쿼리 사용
2. 관련 태그 추가
3. 피드백 제공으로 학습 개선

### Q: 여러 프로젝트의 기억을 분리하려면?

A: 태그나 프로젝트 ID를 활용하세요:

```
@memento remember "프로젝트 A 관련 내용" --tags "project-a"
@memento recall "project-a" --tags "project-a"
```

### Q: 기억을 다른 사람과 공유할 수 있나요?

A: M2+ 버전에서는 팀 공유가 가능합니다:

```
@memento remember "팀 공유 정보" --privacy-scope "team"
```

### Q: 백업은 어떻게 하나요?

A: `export` 명령어로 백업할 수 있습니다:

```bash
# 전체 백업
@memento export --format json > backup.json

# 특정 기간 백업
@memento export --format json --from "2024-01-01" > backup-2024.json
```

## 추가 리소스

- [API 참조 문서](../../api/ko/api-reference.md)
- [개발자 가이드](developer-guide.md)
- [npx·실행 문제 해결](../../operations/ko/npx-troubleshooting.md) · [Node 버전 호환](../../operations/ko/troubleshooting-node-version.md)
- [GitHub 저장소](https://github.com/jee1/memento)
- [커뮤니티 포럼](https://github.com/jee1/memento/discussions)
