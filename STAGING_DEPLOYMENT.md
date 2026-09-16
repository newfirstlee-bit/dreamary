# 테스트 서버 배포 자동화

2026-09-13. **무료 Netlify 계정에서 실제 테스트 서버 배포까지 완료했다.** 배포 ID `6aa6aa3da06f6a1a5a2eedec`, ready 및 홈페이지 HTTP 200 확인. 배포 후 인증·페어 제한 API 검사 16개도 통과했다. 최신 후속 상태는 `STAGING_SETUP.md`를 따른다.

## 실행 방법

프로젝트 폴더에서 다음 명령을 사용한다.

```sh
# 인터넷/배포 없이 로컬 설정의 준비 여부 확인
npm run deploy:staging:check

# 설정이 준비되면 빌드·검증·테스트 서버 배포·기본 응답 확인
npm run deploy:staging
```

Git 변경 때마다 자동 게시하는 설정은 아니다. 위 명령 한 번으로 실행하는 배포 절차다. 원격 GitHub CI는 회귀 검사를 수행하며 자동 게시하지 않는다.

## 자동으로 처리하는 순서

1. `.env.staging.local` 또는 명시적인 staging 환경 확인. 프로젝트·API 주소·서비스 계정/RSA 키·세션 비밀값이 다르면 중단.
2. Netlify의 실제 사이트 ID·팀·이름·주소와 테스트 대상 일치 확인.
3. 서버의 production 컨텍스트 환경변수와 로컬 테스트 설정 비교. 값이 없거나 다르거나 확인할 수 없으면 업로드 전에 중단.
4. 새 임시 폴더에 필요한 소스만 복사. 기존 `.env.local`, `.netlify`, `.next`, `out`, 아티팩트, 네이티브 프로젝트는 제외. 소스의 심볼릭 링크도 거부.
5. 임시 폴더에서 `npm ci`로 고정 의존성 설치.
6. Netlify CLI 27.1.1과 Next 어댑터를 통해 회귀 검사·웹 빌드·함수 패키징 후 **dreamary-staging 사이트**에 게시.
7. 배포 ready 및 해당 배포가 테스트 사이트에 게시됐는지 확인한 뒤 홈페이지 HTTP 200 확인.
8. 비밀값을 가린 로그와 배포 ID를 `artifacts/staging-deployments/`에 보관하고 임시 폴더 정리.

`--prod`/production 컨텍스트는 **별도 테스트 사이트의 고정 주소에 게시**한다는 의미다. 운영 dreamary 사이트로 배포하지 않는다. `staging-deploy.json`과 코드의 고정 ID를 확인하며, 임의의 `--site` 추가 인수는 거부한다. 루트 `.netlify/state.json`의 운영 연결을 사용하거나 변경하지 않는다.

실패하면 자동 재배포하지 않는다. 업로드 후 상태 확인 실패는 이미 게시되었을 가능성이 있으므로 Netlify의 배포 ID·기록을 먼저 확인한다. `.staging-deploy.lock`이 남으면 실행 중인 프로세스가 없는지 확인한 후에만 제거한다.

## 최초 한 번 필요한 설정

- Firebase `dreamary-staging`: 테스트 서버용 서비스 계정 키, Firestore/소유권 규칙·인덱스, Authentication 및 합성 주제 준비.
- 로컬 `.env.staging.local`: 테스트용 설정과 비밀값. 운영 키를 복사하지 않는다.
- Netlify `dreamary-staging`: 로컬과 동일한 테스트 앱/서버 환경변수를 production 컨텍스트에 설정한다. 현재 무료 요금제에서는 범위 제한/비밀값 표시 옵션 대신 사용자 승인에 따라 builds/functions/post_processing을 포함하는 기본 환경변수를 사용한다. `NEXT_PUBLIC_` 접두사 없는 서버 비밀값은 클라이언트 코드에 넣지 않는다. 로컬 점검 통과가 원격 준비 완료를 뜻하지 않는다.
- Netlify 기존 CLI 로그인 또는 `NETLIFY_AUTH_TOKEN`. 토큰을 명령 인수나 로그에 넣지 않는다.
- Node 22.13 이상과 npm, 의존성 다운로드/Netlify API 연결.

이 자동화는 원격 환경변수를 임의 덮어쓰거나 Firebase 규칙/인덱스를 배포하지 않는다. 서버 환경값이 마스킹되어 비교할 수 없는 경우에도 확인 완료로 간주하지 않고 중단한다. 그 경우 키 설정 단계에서 별도 검증 방식을 정해야 한다.

실제 AI·메일·이미지·푸시는 테스트 키/기기를 준비한 후 별도로 검증한다. 홈페이지 응답 확인은 로그인·DB 권한·푸시 전체 테스트를 대신하지 않는다.

## 검증 기록

- 2026-09-13: 실제 테스트 키와 원격 환경값 대조, 격리 폴더 `npm ci`, 회귀/빌드/함수 패키징, 업로드·게시·HTTP 확인을 모두 실행했다. 기록: `artifacts/staging-deployments/2026-09-13T13-50-14-960Z-5ca958a0.json`.
- 배포 후 `node scripts/check-staging-api.cjs --execute` 16개 통과. 서버 API 인증과 본인/타인 구분, 동시 6회 생성 중 5회 성공/1회 거부, 같은 요청 재시도, 잘못된 비로그인 기기키 거부를 확인했고 합성 자료는 정리했다.
- 아래는 초기 구현 시점 기록이며 현재 미완료 상태를 뜻하지 않는다.

- 전체 회귀 67개 통과. 이 중 배포 전용 5개는 키/대상 혼합 거부, 원격 환경의 컨텍스트·범위 검증, 소스 복사 제외, 로그 비밀값 제거를 확인한다.
- 같은 소스 복사 함수를 사용한 임시 폴더에서 합성 서비스 계정으로 `build:staging` 통과. 테스트 전용 합성 키를 사용했으며 실제 Firebase/Netlify 인증·업로드 검증이 아니다. 이 로컬 실습의 의존성은 기존 node_modules를 사용했고, 실제 npm ci/Netlify 패키징·게시 경로는 아직 검증 전이다.
- 실제 로컬 `deploy:staging:check`는 ‘테스트 전용 Firebase 서비스 계정 설정이 필요합니다’로 종료 코드 1. 네트워크 호출·업로드 없음.
- 앱 화면·네이티브 코드는 이번 자동화 작업에서 변경하지 않았다. 기존 미완료 테스트 앱 동기화/네이티브 검증은 `STAGING_SETUP.md`를 따른다.

CLI의 사이트 지정·게시·컨텍스트 옵션은 [Netlify CLI 공식 문서](https://cli.netlify.com/commands/deploy/), 사이트/환경 조회는 [Netlify API 공식 문서](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/)를 기준으로 구현했다.
