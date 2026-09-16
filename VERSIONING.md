# 버전 변경·배포 필수 규칙

Codex는 앱 버전 변경, 설치 파일 제작, 서버 배포, OTA 패키징·게시 전에 이 문서와 `APP_QA_CHECKLIST.md`, `SECURITY_DEPLOYMENT.md`를 읽는다.

## 표시

- 설치 파일의 정식 버전은 `1.0.0`처럼 표시한다. 개발/운영 표시는 그 뒤 `· app · dev` / `· app · prod`로 유지한다.
- OTA만 수정하면 정식 버전을 올리지 않는다. 실제 적용된 수정 회차를 `1.0.0(1)`, `1.0.0(2)`처럼 붙인다.
- 다운로드·다음 실행 예약만으로 회차를 올리지 않는다. 실행 중인 LiveUpdate bundleId와 ZIP 내부 `ota-release.json`이 일치할 때만 표시한다.
- 기본 번들로 복구되면 괄호를 제거한다. 이전 OTA로 복구되면 그 OTA의 회차를 표시한다.
- 새 정식 버전은 OTA 회차 없이 시작한다. 같은 정식 버전·환경의 회차는 재사용하지 않는다. 호스팅 manifest의 sequence는 배포 제어 순번이며 화면 회차와 다르다.

## 작업 순서

1. 변경이 웹 코드/리소스만인지 확인한다. 플러그인·네이티브 설정·권한 변경은 새 설치 파일이 필요하다.
2. 현재 설치본의 native baseline, 환경, 서버 호환성을 확인한다. 불일치를 통과시키려고 기존 baseline을 덮어쓰지 않는다. 새 baseline은 실제 양 플랫폼 빌드 확인 후 별도 파일로 만든다.
3. API 변경이 있으면 호환 서버를 먼저 배포·확인한다. 테스트와 운영을 구분한다.
4. 회귀 검사, `npm run check:app`, 양 플랫폼 sync와 빌드를 수행한다. OTA ZIP은 `npm run ota:package -- --target branch --baseline <검증 파일> --output <새 ZIP> --revision <양의 정수>`로 만든다. 서명키는 환경변수의 파일 경로로만 전달한다.
5. ZIP의 회차·서명·환경·nativeHash를 확인하고 `scripts/ota-host.cjs`로 게시한다. 게시 전에 아래 기록에서 중복 회차가 없는지 확인한다.
6. 앱을 완전히 새로 실행할 때마다 업데이트를 한 번 확인한다. 시간 제한은 없으며 같은 실행 중 중복 호출은 공유한다. 다운로드가 끝난 후 다음 앱 실행에 적용된다. 사용 중 강제 재시작하지 않는다. '게시 완료'와 '기기 적용 완료'를 구분한다.
7. 실제 활성 bundleId 및 마이페이지 괄호 표시를 확인한다. iOS/Android 실기기 미확인은 별도로 남긴다. 설치 파일 갱신 시 기존 앱 위에 설치하며 데이터 삭제를 요구하지 않는다.

## 회차 기록

| 정식 버전 | 환경 | OTA 회차 | 상태 | 내용 |
|---|---|---|---|---|
| 1.0.0 | branch | 14 | build 5 실기기 적용 확인 대기 | 비로그인 UUID·게스트 인증키 네이티브 보조 저장 및 저장 경합 직렬화 |
| 1.0.0 | branch | 8 | iPhone·갤럭시 실기기 적용 확인 | 매 새 실행 OTA 확인, 6시간 제한 제거. manifest sequence 13 |
| 1.0.0 | branch | 9 | build 5 기준 게시, 실기기 적용 대기 | 비밀번호 찾기·백업 이전·프로필 저장 수정. nativeHash `30562bfc…`, manifest sequence 14 |
| 1.0.0 | branch | 7 | 게시 완료 | 비로그인 백업 진행 표시, iOS 클립보드 fallback, 백업코드 이전 순서 수정. manifest sequence 12, nativeHash `0d445871…` |

게시 시 날짜, ZIP 메타데이터 경로, bundleId, nativeHash, manifest sequence, 테스트 결과를 이 표 아래에 기록한다. 과거 회차 표시 없이 게시된 번들은 소급해 적용 완료로 취급하지 않는다.

2026-09-15 게시 기록: OTA ZIP `/private/tmp/dreamary-ota-v7.zip`, bundleId `ed6115f1-0ba6-455d-9f14-e72ae772072c`, branch manifest sequence `12`, Netlify OTA deploy `6aa8f8b8f991095d587326ed`. iPhone `com.repov.dreamary`와 Android `com.dreamary.app`에서 빌드 번호 `4`, OTA 회차 `4` 및 현재 nativeHash 일치를 확인했고, revision 7은 새로 게시했다.

2026-09-15 회차 8 준비: ZIP `/private/tmp/dreamary-ota-v8.zip`, bundleId `4f64c12c-ea34-4c50-add4-cd807f3478a3`, nativeHash `0d445871d657353c9b775280ee061086d038da37b54e22a90f767abc76e7bb73`. 서명·기존 빌드 4 baseline 호환 확인, 회귀 85개(OTA 18개), `check:app`, 양 플랫폼 sync, Android Debug 빌드 통과. iOS 최종 빌드는 Xcode 라이선스 미동의 오류로 중단되어 manifest 준비·게시 및 기기 적용은 미실행이다. 라이선스 동의 후 iOS 빌드를 완료하고 게시한다.

2026-09-15 회차 8 게시 완료: 사용자 Xcode 라이선스 동의 후 iOS Simulator Debug 빌드 통과. manifest sequence `13`, OTA deploy `6aa9074d9cb84603ac3e44b4`, 테스트 서버 deploy `6aa808fc6a3685a80d81c7f2` 유지. 실제 manifest·ZIP HTTP 200, 서명·체크섬·CORS·no-store 확인(`artifacts/ota-2026-09-14/http-verification-v8.json`). 실제 기기의 회차 8 적용은 아직 확인하지 않았다. 구버전의 6시간 제한은 회차 8을 처음 받아 활성화할 때까지 남아 있다.

2026-09-15 실기기 적용 확인: 연결된 iPhone 및 Galaxy SM-A102N에서 기존 설치 파일(build 4)을 유지하고 회차 8의 서명된 OTA를 다운로드·재실행했다. 양쪽 `currentBundleId`가 회차 8 bundleId와 일치하고 `ota-release.json`의 revision 8, `rollback: false`, `ota_startup: ready`, `ota_delivery: current`를 확인했다. iOS는 이번 실행의 UserDefaults 확인 시각 인자만 0으로 지정했고 Android는 해당 OTA 채널 `_checked` 항목만 제거했다. 앱 데이터 삭제·재설치는 수행하지 않았다. 마이페이지 버전 문구의 육안 검증은 별도다. 증거: `artifacts/ota-2026-09-14/physical-devices-v8.json`.

2026-09-15 회차 9 게시·실기기 적용 완료: build 5 네이티브 기준 파일 `/private/tmp/dreamary-native-baseline-v5.json`, OTA ZIP `/private/tmp/dreamary-ota-v9.zip`, bundleId `cb1aba7f-b7b2-40cf-aec4-7cb8dd012909`, nativeHash `30562bfc83b267a4bffaec2470ae7a1baf31399589d3bbe96e490e442f511b69`, revision `9`, manifest sequence `14`, OTA deploy `6aa93a67a6a96f34c5b514fa`. 테스트 서버 deploy `6aa91801a950f23e3478e267`는 유지됐다. iPhone과 Galaxy SM-A102N 모두 build 5에서 첫 실행 `scheduled`, 두 번째 실행 `current`, 활성 bundleId `cb1aba7f-b7b2-40cf-aec4-7cb8dd012909`, `rollback: false`를 확인했다.

2026-09-15 회차 10 게시·실기기 적용 완료: 이미지 즉시 표시·저장 응답 확인·페어 5개 백업 제한·백업 진행 점 애니메이션 수정. OTA ZIP `/private/tmp/dreamary-ota-v10.zip`, bundleId `1b1dc0c3-6462-4e62-8aea-79aab78d235e`, nativeHash `30562bfc83b267a4bffaec2470ae7a1baf31399589d3bbe96e490e442f511b69`, revision `10`, manifest sequence `15`, OTA deploy `6aa942a278190647f0f45c8a`. 회귀 90개, `check:app`, iOS Simulator·Android Debug 빌드와 양 플랫폼 sync 통과. 매니페스트 HTTP 200·서명·체크섬·CORS·no-store 확인. iPhone과 Galaxy SM-A102N에서 첫 실행 `scheduled`, 두 번째 실행 `current`, 활성 bundleId 일치, `rollback: false`, 데이터 삭제 없음. 증거: `artifacts/ota-2026-09-14/physical-devices-v10.json`.

2026-09-15 회차 11 게시·실기기 적용 완료: 비밀번호 찾기 화면을 운영과 동일한 `/api/auth/reset-password` 경로로 전환하고 `RESEND_AUTH_FROM`을 사용하도록 수정. OTA ZIP `/private/tmp/dreamary-ota-v11.zip`, bundleId `92a0fad6-2417-4555-9f44-19cd37c04afa`, nativeHash `30562bfc83b267a4bffaec2470ae7a1baf31399589d3bbe96e490e442f511b69`, revision `11`, manifest sequence `16`, OTA deploy `6aa9452231a629519f7baf49`. 회귀 91개·`check:app` 통과. iPhone과 Galaxy SM-A102N에서 첫 실행 `scheduled`, 두 번째 실행 `current`, `rollback: false`, 데이터 삭제 없음. 서버 재배포 시도 `6aa94440263dfdef6343d095`는 Netlify가 `Deploy canceled`로 중단되어 기존 스테이징 서버 배포 `6aa91801a950f23e3478e267`를 유지했으며, canonical 함수 경로의 OPTIONS·합성 미존재 계정 404 응답은 기존 배포에서 확인했다. 증거: `artifacts/ota-2026-09-14/physical-devices-v11.json`.
2026-09-15 회차 12 게시·실기기 적용 완료: Resend가 수신자를 거부할 때 비밀번호를 먼저 바꾸던 레거시·canonical 재설정 함수를 `메일 발송 성공 후 비밀번호 변경` 순서로 수정하고, `auth.mailDeliveryFailed` 안내를 추가했다. OTA ZIP `/private/tmp/dreamary-ota-v12.zip`, revision `12`, manifest sequence `17`, OTA deploy `6aa94a8b613a0a4720ec3d4a`, origin `https://ota--dreamary-staging.netlify.app`. 서버 배포 `6aa949d4b6d6f7859de464cb` ready. 회귀 92개·`check:app` 통과. iPhone과 Galaxy SM-A102N에서 첫 실행 `scheduled`, 두 번째 실행 `current`, `rollback: false`, 데이터 삭제 없음. 증거: `artifacts/ota-2026-09-14/physical-devices-v12.json`.

2026-09-16 회차 13 게시 완료 후 build 5 실기기 적용 전 회차 14로 교체: 비로그인 UUID·게스트 인증키를 네이티브 Preferences에 보조 저장했다. OTA13 ZIP `/private/tmp/dreamary-ota-v13.zip`, bundleId `c1f5020e-fec3-4524-abff-b5845b1bd269`, nativeHash `30562bfc83b267a4bffaec2470ae7a1baf31399589d3bbe96e490e442f511b69`, revision `13`, manifest sequence `18`, OTA deploy `6aa9a60f0423fc3b6ad4ef1f`. 현재 build 5 실기기에는 회차 14를 적용한다.

2026-09-16 회차 14 게시 완료: 저장·삭제 비동기 경합을 사용자별로 직렬화했다. OTA ZIP `/private/tmp/dreamary-ota-v14.zip`, bundleId `27f6378c-8f74-4a87-a2d0-7dc29dc34eec`, nativeHash `30562bfc83b267a4bffaec2470ae7a1baf31399589d3bbe96e490e442f511b69`, revision `14`, manifest sequence `19`, OTA deploy `6aa9fc7f9212f675f44b3c28`, origin `https://ota--dreamary-staging.netlify.app`. `npm run test:regression` 92개·`npm run check:app`·양 플랫폼 sync/build 통과. OTA8 이전 네이티브 채널의 Android 에뮬레이터는 호환 대상이 아니므로 적용 완료로 기록하지 않았고, build 5 실기기 적용 확인이 남아 있다. 증거: `artifacts/ota-2026-09-14/ota14-application.json`.
