# Memento × External AI Assistants

이 디렉터리는 **이미 쓰고 있는 개인 AI 비서**가 Memento를 공유 장기 기억으로 쓰게 하는 방법을 설명합니다. 새 비서를 만드는 것이 아니라, OpenClaw·NanoClaw·ZeroClaw처럼 기존 비서 설정에 Memento를 **MCP 서버 하나 더** 등록하는 흐름입니다.

먼저 비서 종류를 고르고, 같은 머신이면 stdio·여러 기기를 공유하면 HTTP 트랙을 선택합니다. 그다음 인증·시스템 프롬프트·트러블슈팅은 공통 가이드를 따라가면 됩니다.

## 어떤 비서를 쓰시나요?

- [OpenClaw](./openclaw.md) — Node.js 게이트웨이 + 멀티채널
- [NanoClaw](./nanoclaw.md) — 컨테이너 격리 + Claude Agent SDK
- [ZeroClaw](./zeroclaw.md) — Rust 단일 바이너리

## 트랙 결정

한 대의 PC에서만 비서와 Memento를 돌린다면 **[stdio 트랙](./_shared/transports.md#stdio-트랙)** 이 가장 빠릅니다. 노트북·홈서버·24/7 봇처럼 여러 프로세스가 같은 DB를 봐야 하면 **[HTTP 트랙](./_shared/transports.md#http-트랙)** 으로 Memento를 한 번만 띄웁니다. 상황별 비교 표는 [transports.md](./_shared/transports.md#트랙-결정)에 있습니다.

## 공통 가이드

셋업이 끝나면 아래 문서를 순서대로 참고하면 됩니다.

- [Transport 결정 + 셋업](./_shared/transports.md)
- [인증 / 토큰 관리](./_shared/auth.md)
- [권장 시스템 프롬프트 패턴](./_shared/system-prompt.md)
- [트러블슈팅](./_shared/troubleshooting.md)

## 더 깊은 통합 (옵션)

베어 MCP만으로 부족하면 `@memento/assistant` SDK를 사용해 *결정론적 자동 회상/저장*을 얻을 수 있습니다.

- **빠른 시작**: [`_shared/sdk-quickstart.md`](./_shared/sdk-quickstart.md)
- Node.js / TypeScript 비서에서 두 개의 훅(`beforeUserTurn` / `afterAssistantTurn`)만 붙이면 됩니다.
- ZeroClaw(Rust)는 Node.js SDK를 직접 사용할 수 없으며, 베어 MCP + 시스템 프롬프트 패턴을 권장합니다.
