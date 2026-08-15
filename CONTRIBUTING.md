# 기여하기 (Contributing)

Memento에 기여해 주셔서 감사합니다. 이 문서는 **처음 PR을 올리는 사람**이 어디서부터 손대면 되는지, 버그·기능·문서 기여 시 무엇을 적어야 하는지를 안내합니다. 개발 환경은 [developer-guide.md](docs/guides/ko/developer-guide.md)와 [AGENTS.md](AGENTS.md)가 더 깊게 다룹니다.

## 🚀 빠른 시작

GitHub에서 [memento 저장소](https://github.com/jee1/memento)를 포크한 뒤 로컬에 클론하고, 의존성을 설치한 다음 개발 서버와 테스트를 한 번 돌려 보면 준비가 끝납니다.

### 1. 저장소 포크

1. GitHub에서 저장소를 포크합니다.
2. 포크한 저장소를 클론합니다:
   ```bash
   git clone https://github.com/your-username/memento.git
   cd memento
   ```

### 2. 개발 환경 설정
```bash
# 의존성 설치
npm install

# 개발 서버 시작
npm run dev

# 테스트 실행
npm run test
```

## 📋 기여 방법

### 버그 리포트

버그를 발견했다면 GitHub Issue에 **무엇이 기대와 다른지**, **어떻게 재현하는지**, **어떤 환경인지**를 적어 주세요. 재현 단계는 numbered list로, 환경은 OS·Node.js 버전 정도면 충분합니다.

### 기능 제안

새 기능은 **어떤 문제를 풀려는지**와 **누가 쓰는지**가 핵심입니다. 구현 아이디어가 있다면 덧붙여 주시면 논의가 빨라집니다.

### 코드 기여

코드 PR은 보통 **이슈로 범위를 맞춘 뒤** `feature/` 또는 `fix/` 브랜치에서 구현하고, 테스트와 Conventional Commits를 거쳐 PR을 올립니다. GitHub PR 템플릿(`.github/PULL_REQUEST_TEMPLATE.md`)과 [PR 설명 예시](docs/operations/ko/pr-description-example-npm-workflow.md)를 참고하면 리뷰가 빨라집니다. 지식 복리(Compound Engineering `/ce-compound`)는 템플릿의 **「지식 복리」** 섹션을 따릅니다.

1. **이슈 생성** — 작업 범위·수용 기준을 먼저 적습니다.
2. **브랜치 생성** — `feature/<slug>` 또는 `fix/<slug>`.
3. **구현·테스트** — Vitest 스펙을 추가하거나 갱신합니다.
4. **커밋·PR** — `feat:`, `fix:`, `docs:` 등 Conventional Commits 형식.

## 🛠️ 개발 가이드라인

TypeScript(Node.js ≥24), 2칸 들여쓰기, 단일 따옴표, 세미콜론을 사용합니다. 포맷과 린트는 저장소 ESLint 설정을 따르며, PR 전 `npm run lint`, `npm run type-check`, `npm test`를 통과시킵니다.

### 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 형식을 사용합니다. 스코프는 패키지나 도메인 이름을 쓰면 검색하기 좋습니다.

```
type(scope): description

[optional body]

[optional footer(s)]
```

**타입 예시:**
- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 스타일 변경 (포맷팅, 세미콜론 등)
- `refactor`: 코드 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 빌드 프로세스, 도구 변경

**예시:**
```
feat(search): 하이브리드 검색 엔진 추가
fix(memory): 메모리 누수 문제 해결
docs(readme): 설치 가이드 업데이트
```

### 테스트

Vitest로 단위 스펙(`*.spec.ts`)은 각 패키지 `src/` 아래에 두고, 워크스페이스·통합 시나리오는 루트 `tests/`에 둡니다. PR 전 `npm run test`로 전체 스위트를 돌리는 것을 권장합니다.

### 브랜치 전략

`main`은 릴리스용 안정 브랜치입니다. 기능은 `feature/*`, 수정은 `fix/*`, 문서는 `docs/*`, 유지보수는 `chore/*` 패턴을 씁니다.

## 📁 프로젝트 구조

npm workspaces 모노레포입니다. 도메인·DB·MCP 도구 구현은 **`packages/memento-core`**에, MCP/HTTP 서버는 **`packages/memento-server`**에 있습니다. 루트 **`tests/`**에는 워크스페이스·통합 수준 Vitest 스위트가 있고, 빌드·검증·운영 보조 스크립트는 주로 **`scripts/`**에 있습니다.

```
packages/
├── memento-core/     # @memento/core — 도메인 로직, DB, MCP 도구
├── memento-server/   # MCP stdio + HTTP 서버
└── memento-client/   # @jee1/memento-client — 서버 연결 클라이언트
apps/
└── experimental-example/   # in-process 사용 예시
scripts/              # 빌드·검증·운영 보조 스크립트
tests/                # 루트 워크스페이스 통합·품질 게이트 스펙 등
```

자세한 디렉터리 역할은 [AGENTS.md](AGENTS.md)를 참고하세요.

## 🔍 코드 리뷰 프로세스

PR이 올라오면 CI가 lint·type-check·test를 돌리고, 최소 한 명의 리뷰어 승인 후 `main`에 병합합니다. 피드백은 같은 브랜치에 커밋으로 반영하면 됩니다.

## 🐛 버그 수정

버그 PR은 **재현 테스트 → 수정 → 전체 테스트 green → 관련 문서 갱신** 순서를 권장합니다. 재현이 어렵다면 Issue에 환경·로그를 남겨 두면 리뷰어가 따라가기 쉽습니다.

## ✨ 기능 추가

기능은 Issue에서 설계·수용 기준을 먼저 맞춘 뒤, 테스트와 구현, 사용자/API 문서를 함께 PR에 넣습니다. 공개 API나 MCP 도구 시그니처가 바뀌면 `docs/api`와 CHANGELOG를 함께 갱신하세요.

## 📚 문서화

문서를 업데이트할 때:
- **한국어 우선**: 한국어 문서를 우선으로 작성합니다.
- **영어 번역**: 필요시 영어 문서도 업데이트합니다.
- **예시 포함**: 코드 예시와 사용 사례를 포함합니다.
- **최신 상태 유지**: 코드 변경사항과 동기화합니다.

## 🤝 커뮤니티

- **이슈**: [GitHub Issues](https://github.com/jee1/memento/issues)
- **토론**: [GitHub Discussions](https://github.com/jee1/memento/discussions)
- **문서**: [Wiki](https://github.com/jee1/memento/wiki)

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 기여하시는 코드는 동일한 라이선스 하에 배포됩니다.

## 🙏 감사

모든 기여자분들께 감사드립니다! 여러분의 기여가 Memento를 더 나은 프로젝트로 만들어줍니다.

---

**질문이 있으시면 언제든지 이슈를 생성하거나 토론에 참여해주세요!**
