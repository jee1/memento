# Quickstart: 앵커 맵 검색 회귀 검증

## 준비

```bash
cd /home/jee1lee/git/memento
npm install
npm run dev:http
```

브라우저에서 대시보드 앵커 맵 페이지를 연다(일반적으로 `http://127.0.0.1:<포트>/dashboard` — 로컬 설정은 `env`·서버 로그 참고).

## 필수 시나리오 (이슈 #150 / SC-003)

1. 맵에 **노드가 없거나** 아직 그려지지 않은 상태를 만든다(빈 데이터 또는 로드 직후).
2. 검색어를 입력하고 **검색** 실행.
3. `search_local`이 성공하면 **브라우저 콘솔에 `TypeError: ... undefined ... find`** 가 나오지 않아야 한다.
4. 이후 맵이 채워지면 **동일 세션**에서 검색을 다시 시도해 하이라이트·탐색이 가능한지 확인한다.

## 회귀 (SC-002)

노드가 있는 정상 데이터에서 검색 후 첫 결과에 대한 시각적 식별·포커스가 **이전과 동일**한지 확인한다.

## 품질 게이트

```bash
npm run lint
npm run type-check
npm test
```
