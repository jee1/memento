# fix: npm 배포 워크플로우에 토큰 검증 단계 추가

## 📋 개요

npm 배포 시 발생하는 "Access token expired or revoked" 에러를 사전에 감지하고 명확한 안내를 제공하기 위해 워크플로우에 토큰 검증 단계를 추가했습니다.

## 🐛 문제

- npm publish 시 "Access token expired or revoked" 에러 발생
- 토큰 문제를 사전에 감지하지 못하여 배포가 실패한 후에야 문제를 알 수 있음
- 에러 메시지가 불명확하여 해결 방법을 파악하기 어려움

## ✅ 해결

### 1. npm 토큰 검증 단계 추가
- `npm whoami` 명령으로 토큰 유효성 사전 검증
- 토큰이 유효하지 않은 경우 배포 전에 실패하여 시간 절약

### 2. 명확한 에러 메시지 제공
- NPM_TOKEN이 설정되지 않은 경우 명확한 에러 메시지
- 토큰이 유효하지 않은 경우 해결 방법 안내 링크 제공

### 3. 조기 실패 메커니즘
- 토큰 문제를 publish 전에 감지하여 불필요한 빌드 시간 절약

## 📊 변경 통계

- **파일 변경**: 1개 파일
- **추가된 코드**: +18줄

## 🔄 주요 변경사항

### `.github/workflows/release.yml`

#### 추가된 단계: Verify npm token
```yaml
- name: Verify npm token
  run: |
    echo "Verifying npm token..."
    if ! npm whoami --registry=https://registry.npmjs.org/ 2>/dev/null; then
      echo "❌ Error: npm token is invalid or expired"
      echo "Please update NPM_TOKEN in GitHub Secrets"
      echo "Get a new token from: https://www.npmjs.com/settings/YOUR_USERNAME/tokens"
      exit 1
    fi
    echo "✅ npm token is valid"
```

#### 개선된 단계: Configure npm registry
- NPM_TOKEN이 설정되지 않은 경우 조기 실패

## 🧪 테스트 결과

- 워크플로우 문법 검증 통과 ✅
- 토큰 검증 로직 정상 작동 ✅

## 🔒 하위 호환성

- ✅ 기존 워크플로우 동작 유지
- ✅ 토큰이 유효한 경우 기존과 동일하게 동작
- ✅ 추가 검증 단계만 추가되어 성능 영향 최소화

## 📝 사용자 조치 필요

npm 배포가 실패하는 경우:

1. **npm에서 새 토큰 생성**:
   - https://www.npmjs.com/settings/YOUR_USERNAME/tokens 접속
   - "Generate New Token" 클릭
   - "Automation" 타입 선택 (읽기/쓰기 권한)
   - 토큰 복사

2. **GitHub Secrets 업데이트**:
   - Repository → Settings → Secrets and variables → Actions
   - `NPM_TOKEN` 시크릿 수정
   - 새 토큰 값으로 업데이트

3. **워크플로우 재실행**:
   - 개선된 워크플로우가 토큰을 검증하고 명확한 에러 메시지를 제공합니다

## ✅ 체크리스트

- [x] 코드 리뷰 준비 완료
- [x] 워크플로우 문법 검증 통과
- [x] 하위 호환성 보장
- [x] 명확한 에러 메시지 제공

## 🔍 리뷰 포인트

1. **토큰 검증 로직**: `npm whoami`를 사용한 토큰 검증이 적절한지 확인
2. **에러 메시지**: 사용자가 쉽게 이해하고 조치할 수 있는 메시지인지 확인
3. **성능 영향**: 추가 검증 단계로 인한 워크플로우 실행 시간 증가가 허용 범위 내인지 확인
