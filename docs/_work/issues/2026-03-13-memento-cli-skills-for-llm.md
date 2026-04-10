---
name: 기능 제안
about: Memento CLI를 LLM이 사용할 수 있도록 Skills 제작
title: '[FEATURE] Memento CLI를 LLM이 사용할 수 있도록 Skills 제작'
labels: ['enhancement', 'needs-triage']
assignees: ''
GitHub Issue: https://github.com/jee1/memento/issues/112
---

## 🚀 기능 설명

LLM(에이전트)이 Memento CLI를 **언제·어떻게** 사용할지 안내하는 **Skill**을 제작합니다.  
CLI 자체는 [#110](https://github.com/jee1/memento/issues/110)으로 구현되어 있고, [Memento CLI for AI 가이드](../../guides/ko/memento-cli-for-ai.md)도 있으나, 에이전트가 이 정보를 **자동으로 발견하고 워크플로를 적용**하도록 하는 스킬(SKILL.md 등)은 아직 없습니다.

- **Cursor**: Agent Skill(SKILL.md) 형태로 “작업 전 recall/memory_injection, 작업 후 remember” 등 워크플로와 트리거를 제공.
- **기타 에이전트(Codex, 터미널 전용 에이전트 등)**: 동일한 워크플로·명령 목록·예제를 참조할 수 있는 문서 또는 스킬 포맷 제공.

## 💡 동기

- **현재**: AI가 터미널에서 `memento recall ...`, `memento remember ...`를 실행할 수는 있지만, “언제 recall을 호출하고, 언제 remember를 호출할지”에 대한 **discoverability**와 **일관된 워크플로**가 에이전트별로 없음.
- **문제**: 매 대화마다 사용자가 “작업 전에 recall 해줘”, “끝나면 remember 해줘”라고 지시해야 하거나, AGENTS.md 규칙만으로는 플랫폼별 스킬 목록에 노출되지 않아 에이전트가 스킬을 **선택**하지 못함.
- **해결**: Cursor 등에서 **Skill**으로 등록하면, 에이전트가 “Memento CLI 사용” 시나리오에서 해당 스킬을 적용해 작업 전/후 recall·remember를 자연스럽게 수행할 수 있음.

## 📝 상세 설명

1. **Cursor용 Skill (SKILL.md)**  
   - **트리거**: “memento CLI 사용”, “기억 조회/저장”, “recall/remember”, “Memento 기반 컨텍스트” 등.  
   - **내용**:  
     - 작업 전: `recall` 또는 `memory_injection`으로 관련 기억 조회.  
     - 작업 후: `remember`로 episodic(완료 기록)/semantic(지식)/procedural(절차) 저장.  
     - 앵커 사용 시: `set_anchor` / `search_local` / `clear_anchor` 안내.  
   - **참조**: [Memento CLI for AI 가이드](../../guides/ko/memento-cli-for-ai.md), 명령별 인자·설정(DB_PATH, ~/.memento/.env), 예제 호출.

2. **문서/아티팩트**  
   - 스킬 본문에 “명령 목록·한 줄 설명”, “워크플로(작업 전/후)”, “예제 호출·출력 규칙(stdout=JSON, exit code)” 요약.  
   - 필요 시 `memento schema` 또는 가이드 링크로 상세 스키마 참조.

3. **AGENTS.md와의 연계**  
   - AGENTS.md의 “Memento CLI 사용” 섹션과 동일한 워크플로를 스킬에서 참조하거나, 스킬이 “AGENTS.md의 CLI 지침을 구체화한 것”으로 명시.

## 🎯 사용 사례

1. **Cursor에서 작업할 때**: 에이전트가 “Memento CLI 사용” 스킬을 적용해, 작업 시작 전 자동으로 `recall` 또는 `memory_injection`으로 관련 기억을 불러오고, 작업 완료 후 `remember`로 결과를 저장하고 싶을 때.
2. **터미널만 쓰는 CLI 에이전트**: MCP 없이 `memento` 명령만 사용하는 환경에서, 동일한 워크플로·명령 목록·예제가 담긴 스킬/문서를 참고해 일관되게 사용하고 싶을 때.
3. **프로젝트 온보딩**: 새 기여자나 다른 에이전트가 “이 프로젝트에서는 작업 전/후 Memento를 이렇게 쓴다”는 것을 한 곳(Skill + 가이드)에서 파악하고 싶을 때.

## 🔧 구현 아이디어

- **저장 위치**:  
  - 프로젝트 스킬: `.cursor/skills/memento-cli/` 또는 `docs/skills/memento-cli-for-ai/` 등.  
  - 개인 스킬 예시: `~/.cursor/skills/`용 버전을 가이드에 링크.
- **구조**:  
  - `SKILL.md`: 트리거, 워크플로(작업 전/후, 앵커), 명령 목록·요약, 설정(DB_PATH, ~/.memento/.env), 예제 호출.  
  - 선택: `reference.md`에 가이드 전체 요약 또는 링크, `examples.md`에 recall/remember/memory_injection 예제.
- **검증**: Cursor에서 해당 스킬을 활성화한 뒤, “이전에 논의한 API 스펙 recall 해줘” / “이 작업 결과 remember 해줘” 등으로 워크플로가 적용되는지 확인.

## 📊 우선순위

- [x] 중요 (사용성 향상)  
- [ ] 매우 중요 (핵심 기능)  
- [ ] 보통 (편의 기능)  
- [ ] 낮음 (선택적 기능)

## 🔗 관련 이슈·문서

- **이슈**: [#110 Memento CLI for AI](https://github.com/jee1/memento/issues/110)  
- **가이드**: [Memento CLI for AI 가이드](../../guides/ko/memento-cli-for-ai.md)  
- **설계**: [memento-cli-for-ai-review.md](../design/memento-cli-for-ai-review.md)  
- **AGENTS.md**: 루트 AGENTS.md “Memento CLI 사용 (AI/스크립트)” 섹션

## ✅ 체크리스트

- [x] 이슈가 이미 존재하지 않는지 확인했습니다  
- [x] 기능이 기존 CLI·가이드와 중복되지 않고, “스킬 제작”으로 보완하는 것임을 확인했습니다  
- [x] 필요한 정보를 모두 제공했습니다  
