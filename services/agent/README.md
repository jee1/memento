# Memento Agent (services/agent)

## 환경 설정

- **템플릿(추적 대상)**: `env.example` — 저장소에 커밋됩니다. 신규 환경에서는 이 파일을 복사해 사용합니다.
- **로컬 런타임(비추적)**: `.env` — `gitignore` 대상이며, 각자의 비밀/로컬 값을 넣습니다.

```bash
cd services/agent
cp env.example .env
# 필요 시 값 수정
```

루트 `env.example`의 `MEMENTO_AGENT_*` 변수와의 매핑·우선순위는 `docs/guides/ko/environment-variable-governance.md`를 참고합니다.
