# OTA 도입 상태와 배포 절차

2026-09-15 최신 상태: **branch nativeHash `0d445871…` 기준 manifest sequence 13 / 화면 회차 8 OTA 게시 완료. 회귀 85개(OTA 18개), 앱 검사·양 플랫폼 sync·iOS Simulator/Android Debug 빌드와 원격 manifest·ZIP HTTP 200/서명/체크섬 검증을 통과했다.** OTA deploy `6aa9074d9cb84603ac3e44b4`, 기존 테스트 서버 deploy `6aa808fc6a3685a80d81c7f2` 유지.

회차 8에는 매 새 실행 확인·6시간 제한 제거를 포함했다. 연결된 iPhone·Galaxy SM-A102N에서 회차 8 활성 bundleId/메타데이터, 정상 시작 및 `ota_delivery: current`를 확인했다. 기존 앱·데이터를 유지하고 OTA 확인 대기만 해제해 다운로드·재실행했다. 현재 4~7회차 앱은 이번 수정본을 처음 받아 적용할 때까지 기존 6시간 제한이 남으며, 8회차 활성화 후부터 아래 새 규칙으로 동작한다. 아래 초기 단계 기록보다 이 상단 상태가 우선한다.

## 무료 방식 구현과 현재 상태

- 별도 유료 OTA 가입 없이 기존 Netlify 테스트 사이트의 `https://ota--dreamary-staging.netlify.app` 별칭에 정적 파일만 게시한다. 대표 테스트 서버 배포와 운영 사이트는 변경하지 않는다. 실제 첫 게시 후 대표 테스트 서버 배포 ID 유지 확인.
- 앱 시작 신호 뒤 서명된 설명 파일을 확인한다. 완전히 새로 실행할 때마다 한 번 확인하며 시간 제한은 없다. 같은 실행 중 중복 호출은 공유하고, 탭 이동·광고 복귀마다 요청하지 않는다. Firebase 추가 조회는 0회다. 설명 파일 최대 24KB·응답 제한 8초, ZIP 생성 상한 20MB, 네이티브 다운로드 HTTP 제한 30초다.
- 설치된 native 채널과 번들 환경·버전·native 해시를 비교한다. 설명 파일은 Web Crypto, ZIP은 네이티브 플러그인에 넣은 공개키로 검증한다. 실패 번들 차단, 이전 순번 재생 거부, 30일 만료를 적용한다. 정상 다운로드 후 다음 앱 시작에만 적용한다.
- `pause`는 예약된 업데이트를 취소하고 현재 번들을 유지한다. `reset`은 다음 실행에 설치 파일의 기본 번들로 복구한다. 두 명령도 서명과 증가하는 순번이 필요하다. 이미 정상 적용된 예전 OTA로 돌아가려면 그 파일을 더 높은 순번으로 다시 지정한다.
- 무료 요금제의 네트워크·요청 한도를 공유한다. 무제한 무료가 아니며, 한도 초과 시 사이트가 일시 중지될 수 있다. 유료 전환·자동 충전·결제 설정 변경은 하지 않았다. [Netlify 무료 한도 안내](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)

| 확인 항목 | 실제 결과 |
| --- | --- |
| 최신 회귀 검사 | 85개 통과, OTA 18개 포함 |
| 최신 앱 검사·동기화·빌드 | `check:app`, 양 플랫폼 sync, iOS Simulator/Android Debug 통과 |
| 첫 정적 게시 | `6aa74dcf31deb214e972f24e`, ready, 대표 서버 `6aa6aa3da06f6a1a5a2eedec` 유지 |
| 실제 HTTP | 설명·ZIP 200, CORS, no-store, 체크섬·서명 통과 |
| 가상기기 첫 실행 | Android에서 async 반환한 Capacitor Proxy의 `then()` 호출 문제 발견; 공통 어댑터로 수정 및 회귀 추가 |
| 수정된 두 번째 파일 | `staging-selfhost-v2.zip` 약 1.03MB 생성, 서명 검증 완료, 순번 2로 로컬 준비 |
| 수정본 게시 | 완료: deploy `6aa7abc83dd492212055a769`, ready. 기존 테스트 서버 deploy `6aa6aa3da06f6a1a5a2eedec` 유지 |
| 수정본 HTTP·서명 검증 | 완료: manifest·ZIP HTTP 200, CORS·체크섬·서명 확인. `artifacts/ota-2026-09-14/http-verification-v2.json` |
| 수정본 재설치·기기 적용 | 완료: 전용 iOS·Android 가상기기에 설치 → 다운로드·서명 검증 → 완전 종료·재실행 후 순번 2 번들 활성화 확인 |
| 실제 변조 거부·실패 번들 복구·임시저장 유지 | 변조는 로컬·HTTP 서명 검증까지 확인. 전용 Android 가상기기에서 네트워크 차단 후 기존 번들 유지·OTA 실패 처리, 구문 오류 번들의 `ChunkLoadError`·기본 번들 롤백·실패 번들 차단까지 확인. 실제 사용자 임시저장/로그인 회귀는 남아 있음 |
| 실패 번들 시험 후 스테이징 복원 | 완료: 실패 시험 순번 4를 차단하고 정상 순번 5로 복원. 최신 복구 기록 `artifacts/ota-2026-09-14/failure-recovery-android-v1.json` |
| 2026-09-15 회차 표시 포함 게시 | 완료: 빌드 번호 4·nativeHash `0d445871…` 설치 파일과 회차 4 ZIP을 게시하고 iPhone·Android 실기기에서 `ota-release.json` 확인 |

실제 iOS Bundle ID는 `com.repov.dreamary`, Android는 `com.dreamary.app`이다. Capacitor 설정의 appId만 보고 이미 생성된 iOS 프로젝트 ID를 추정하지 않는다. 양쪽 실제 버전은 1.0.0/build 2이며, 스토어 제출 전 새 빌드 번호가 필요하다.

## 이어서 실행할 순서

1. 순번 2 게시·원격 서명 검증·전용 가상기기 콜드스타트 적용은 완료됐다.
2. 변조·잘못된 키·오프라인 기동·실패 번들 복구는 로컬/HTTP와 전용 Android 가상기기까지 확인했다. 실패 번들은 기본 번들로 롤백되고 차단되며, 정상 순번 5 번들로 기기를 복원했다. 임시저장 유지·중지/복구와 실기기 광고·로그인·푸시는 이후 앱 QA와 함께 확인한다.
3. 실제 release 채널은 비활성이다. 운영 준비 검토 후 별도 운영 서명키·호스팅·정식 native 기준으로 연결한다.

## 무료 호스팅 운영 명령

테스트 서명 비공개 키는 Git 제외 `.ota-private/branch-signing.pem`에 권한 600으로 보관하고 공개키만 `ota.config.json`에 넣었다. 비공개 키를 외부 서버에 올리지 않는다. 별도 안전한 백업은 운영 전 필요하다. 키를 잃거나 교체하면 새 native 설치 파일이 필요하다.

```sh
# 앱 검사 후, 검증한 native 기준에 맞는 ZIP 생성
npm run check:app
OTA_SIGNING_KEY_FILE=.ota-private/branch-signing.pem npm run ota:package -- \
  --target branch --baseline artifacts/ota-2026-09-14/selfhost-native-baseline.json \
  --output /secure/path/new-update.zip

# 순번은 기존보다 큰 정수. 준비 명령은 업로드하지 않는다.
OTA_SIGNING_KEY_FILE=.ota-private/branch-signing.pem npm run ota:host -- \
  --prepare --baseline artifacts/ota-2026-09-14/selfhost-native-baseline.json \
  --bundle /secure/path/new-update.zip --sequence 3 --action update
npm run ota:host -- --deploy
```

중지·기본 번들 복구는 `--action pause` 또는 `--action reset`과 더 높은 순번을 사용하고 `--bundle`을 생략한다. 기기에서 다음 확인 때 반영되므로 즉시 전체 기기 강제 중지가 아니다. 30일 만료 전에 필요하면 같은 번들을 높은 순번으로 다시 서명한다. 한 사람이 한 컴퓨터에서 순차 게시하는 초기 운영 도구이며, 여러 운영자가 동시에 쓰기 전 배포 잠금·원격 순번 충돌 방지가 추가로 필요하다. `.ota-hosting`과 검증 기준·서명키는 Git에 포함하지 않는다.

## 초기 기초 작업 기록 (무료 방식 선택 전)

## 완료한 범위

| 항목 | 상태 |
| --- | --- |
| Capacitor Live Update 플러그인 | `@capawesome/capacitor-live-update` 8.4.2 고정, iOS·Android 동기화 |
| 앱 시작 확인 | 첫 클라이언트 렌더 이후 `ready()` 호출, 반복 마운트 중복 방지 |
| 웹·구버전 앱 | 네이티브 플러그인이 없으면 호출 생략 |
| 시작 실패 복구 설정 | 15초 제한, 실패 번들 차단, 사용하지 않는 번들 정리 설정 |
| 사용자 작업 보호 | 현재 런타임은 다운로드·강제 재시작·사용자 데이터 변경을 하지 않음 |
| 호환성 검사 | 앱 버전, native 소스·의존성 해시, 테스트/운영 대상, Firebase/API 일치 검사 |
| 로컬 파일 생성 | ZIP 루트 `index.html`, RSA 서명·SHA-256, 숨김파일·키·소스맵·심볼릭 링크 거부 |
| iOS 필수 API 선언 | UserDefaults CA92.1 선언을 빌드된 앱에 포함 |

추가 Firebase 조회는 0회다. `CapacitorHttp.enabled=false`를 유지한다. iOS 개인정보 선언은 이번 플러그인의 필수 API 사유이며 앱 전체 개인정보 심사 완료를 뜻하지 않는다.

`ready()`는 시작 신호다. 로그인·광고·채팅 등 모든 기능의 정상 동작을 보장하지 않는다. 플러그인의 시작 실패 복구 대상은 **앱 설치 파일에 포함된 기본 화면 묶음**이며, 직전 OTA 버전으로 복원된다고 가정하면 안 된다. 전용 Android 가상기기에서 구문 오류 번들의 시작 실패·기본 번들 복구·실패 번들 차단을 확인했으며, 실제 사용자 임시저장·로그인 흐름은 별도다.

## 확인 결과

- `npm run test:regression`: 74개 통과, 실패 0개. 이 중 OTA 검사 7개.
- `npm run check:app`, `npx cap sync`, iOS Simulator Debug·Android Debug 빌드 통과.
- 최종 iOS 앱과 Android APK에 branch 환경 설명 파일 포함 확인. iOS 개인정보 선언 포함 확인.
- 약 1.03 MB / 130개 파일의 로컬 ZIP 생성. 체크섬·RSA 서명 검증, 1바이트 변조 거부, ZIP 무결성 확인.
- 증거: `artifacts/ota-2026-09-14/verification.json`, `native-baseline.json`.
- `staging-local-test.zip`은 **일회성 테스트 키**로 서명했으며 키는 검사 후 삭제했다. 이 파일을 배포하거나 운영 키로 재사용하지 않는다.

## 배포 전 남은 순서

1. **사용자 선택:** 관리형 서비스 또는 무료 우선 직접 호스팅. 현재 플러그인은 두 방식 모두 지원한다. 가입·결제·유료 체험 시작은 하지 않았다.
2. 선택한 배포 경로와 테스트/운영 채널을 연결한다. 업데이트 확인은 횟수를 제한하고 실패 시 기존 앱을 계속 사용한다. 다운로드 완료 후 다음 앱 시작에 반영하며 작성·로그인·광고 복귀 중 강제로 새로고침하지 않는다.
3. 실제 서명키를 별도 보관하고 공개키를 네이티브 설정에 넣는다. 현재 앱에는 공개키가 없으므로 **기기에서 서명이 강제 검증되는 상태가 아니다.** 다운로드 연결 전에 반드시 완료한다. 키 원문은 저장소·문서·로그에 남기지 않는다.
4. 양 플랫폼을 다시 빌드하고 해당 설치 파일의 기준 정보를 확정한다. 테스트 파일을 생성할 때 사용하는 로컬 기준 파일을 실제 배포 기준으로 승격하지 않는다.
5. 실제 기기에서 정상 다운로드 → 앱 재시작 → 새 화면 확인, 변조·잘못된 서명 거부, 시작 실패 → 기본 번들 복구, 오프라인·임시저장·로그인 유지까지 확인한다.
6. 운영/확장성 변경의 서버·규칙·인덱스·실기기 검증을 마친 뒤 정식 앱을 출시한다. 새 네이티브 플러그인이 들어가므로 최초에는 새 설치 파일 배포가 필요하다. 이후 호환되는 화면·JS·정적 자산 변경을 OTA로 전달한다.

화면 레이아웃 변경 범위가 커도 기존 네이티브 기능 안에서 구현되면 OTA 후보가 될 수 있다. 새 네이티브 기능·권한·플러그인 변경은 별도 설치 파일 대상으로 분류한다. 스토어 정책 검토는 각 기능 출시 때 별도로 수행한다.

## 로컬 패키지 명령

실제 배포용 공개키를 포함해 검증한 설치 파일과 동일한 native 기준 정보가 준비된 뒤 사용한다.

```sh
npm run check:app
OTA_SIGNING_KEY_FILE=/secure/path/private.pem npm run ota:package -- \
  --target branch \
  --baseline /secure/path/verified-native-baseline.json \
  --output /secure/path/new-update.zip
```

명령은 업로드하지 않는다. ZIP과 `.zip.json` 서명 메타데이터만 생성하며 기존 파일을 덮어쓰지 않는다. release는 `npm run build:app:release`와 release 전용 기준 파일을 사용한다. branch 파일을 release에 재사용하면 검사가 실패한다.

기준 파일은 `out/ota-build.json`의 환경·native 정보와 실제 양 플랫폼 빌드 검증 기록(`verifiedNativeBuilds`)을 함께 보관한다. 이 기록을 수동으로 true로 바꾸어 검사를 우회하지 않는다. `package-lock.json` 전체를 native 해시에 넣어 의존성 변경 시 보수적으로 차단한다. 따라서 JS 전용 의존성 변경도 재검토가 필요할 수 있다.

호환성 검사는 로컬 패키징 단계의 보호 장치다. 현재 설명 파일만으로 기기에서 다른 채널의 번들이 차단되는 것은 아니다. 배포 연결 시 채널·native 호환 대상 제한도 적용해야 한다. 서명도 승인된 파일임을 확인할 뿐 기능 오류나 소스에 잘못 넣은 비밀값까지 탐지하지는 못한다.

공식 근거: [Capawesome Live Update 문서](https://capawesome.io/docs/sdks/capacitor/live-update/), [요금 안내](https://capawesome.io/pricing/). 관리형 서비스의 결제 주기·할당량은 선택 시 다시 확인한다.
