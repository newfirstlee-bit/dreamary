# 테스트 환경 분리 — 진행 상태

> 무료 OTA 후속: `ota--dreamary-staging.netlify.app`에 정상 번들을 순번 2로 게시하고 HTTP·서명 검증을 완료했다(deploy `6aa7abc83dd492212055a769`). 이후 전용 Android 가상기기에서 오프라인 기동, 구문 오류 순번 4의 기본 번들 롤백·차단, 정상 번들 순번 5 복원을 확인했다. 원래 테스트 서버 배포는 유지된다. 실기기·임시저장 회귀는 남아 있다. 최신 절차는 `OTA_SETUP.md` 상단을 따른다.

> 2026-09-14 OTA 후속: 앱 연동·로컬 서명 패키지 검증, 회귀 74개, 앱 검사·양 플랫폼 sync/빌드를 완료했다. 실제 업데이트 배포는 미연결이며 남은 순서는 `OTA_SETUP.md`를 따른다. OTA 작업의 Android 빌드 승인 제한은 재시도 후 해결됐다. 아래 원격 CI 조회의 과거 차단과는 별개다.

2026-09-13. **무료 Netlify 계정으로 테스트 서버 배포, 인증·페어 API 검증, iOS·Android 빌드까지 완료했다.** 이번 작업에서 운영 Firebase/Netlify는 변경하지 않았다. 색인 15개 모두 READY이며 실제 페이지 조회도 통과했다.

| 구분 | 운영 | 테스트 환경 |
| --- | --- | --- |
| Firebase | dreamary-1a9af | dreamary-staging |
| Netlify | dreamary | dreamary-staging |
| 서버 | https://dreamary.netlify.app | https://dreamary-staging.netlify.app |
| 앱 명령 | build:app:release | build:app / check:app |
| 환경 파일 | .env.local | .env.staging.local (Git 제외, 권한 600) |

## 완료

- Firestore 서울 리전, 이메일/비밀번호 인증, 테스트 도메인 허용, 소유권 규칙 게시 및 로컬 내용 일치 확인.
- 운영 키 자동 유입을 막는 환경 로더와 빌드/서버 프로젝트 검증. 테스트 전용 서비스 계정과 세션 비밀값 사용.
- 사용자 승인에 따라 Netlify 기본 환경변수에 서버 비밀값 4개 저장. 무료 요금제의 builds/functions/post_processing 범위를 사용하며 별도 유료 업그레이드는 하지 않았다. 공개 Firebase 값의 불필요한 바깥 따옴표를 제거하고 로컬/원격 전체 환경값 비교를 통과했다.
- 합성 주제 3개와 `topicCatalog/current` 준비. 운영 사용자 자료를 복사하지 않았다.
- `npm run deploy:staging` 실제 실행: 격리 폴더 설치·회귀·빌드·함수 패키징·게시·기본 응답 확인 완료. 배포 ID `6aa6aa3da06f6a1a5a2eedec`, ready, HTTP 200.
- 실제 Firebase 직접 인증/소유권 검사 6개와 배포 서버 API 검사 16개 통과. 로그인·비로그인 토큰 발급/실제 인증, 타인 및 무인증 거부, 동시 6개 페어 생성 중 5개 성공/1개 거부, 재시도 중복 방지, 잘못된 기기키 거부를 확인했다. 합성 계정·문서는 정리했고 등록 사용량 카운터는 유지했다.
- `check:app`, Capacitor 양 플랫폼 sync, iOS Simulator Debug·Android Debug 빌드 통과. JS 67개에서 테스트 API/Firebase 연결과 복사본 일치를 확인했으며 알려진 서버 비밀값 검출 0건.
- 색인 15개 모두 콘솔에서 생성 후 READY 및 로컬 정의 일치를 확인했다. 서비스 계정에 추가 IAM 권한을 부여하지 않았다.
- 합성 일기·채팅 70개로 각 30+5 페이지 조회를 확인했다. 동일 작성시각에서도 ID 정렬로 중복/누락이 없으며 생성 자료 정리 완료. 이 검사는 Admin SDK의 실제 색인/커서 확인이고 UI 검사를 대체하지 않는다.

- 실제 `/api/chat/delete` 한 번 호출 뒤 예약 함수가 남은 대화를 처리해 총 45개 삭제를 완료했다. 추가 클라이언트 요청 없이 약 60초 안에 완료됐으며, 완료 요청 재전송이 새 메시지를 지우지 않음을 확인했다. 관련 6개 검사 통과, 합성 자료 정리 완료.

## 검증 기록과 재실행

| 대상 | 기록 / 명령 |
| --- | --- |
| 서버 배포 | `artifacts/staging-deployments/2026-09-13T13-50-14-960Z-5ca958a0.json` |
| 인증·페어 API | `artifacts/staging-2026-09-13/api-smoke.json` / `node scripts/check-staging-api.cjs --execute` |
| 색인 정의·준비 상태 | `artifacts/staging-2026-09-13/indexes.json` / `node scripts/check-staging-indexes.cjs` |
| 예약 삭제·완료 요청 재시도 | `artifacts/staging-2026-09-13/job-smoke.json` / `node scripts/check-staging-job.cjs --execute` |
| 기록 페이지 조회 | `artifacts/staging-2026-09-13/pagination.json` / `node scripts/check-staging-pagination.cjs --execute` |
| 네이티브 빌드·번들 | `artifacts/staging-2026-09-13/native-builds.json` |
| Firebase 직접 권한 검사 | `artifacts/staging-2026-09-12/firebase-smoke.json` |

배포 명령 한 번으로 검증·빌드·게시하는 자동화다. Git 변경마다 자동 게시하는 방식은 아니다. 자세한 절차는 `STAGING_DEPLOYMENT.md`를 따른다.

## 남은 순서와 직접 개입 여부

### 2026-09-13 원격 CI 준비 결과

- GitHub 기존 인증으로 `newfirstlee-bit/dreamary` 저장소의 push/admin 권한을 확인했다. 저장소는 공개 상태이므로 업로드 후보에서 환경 파일·아티팩트·scratch 스크립트를 제외했다.
- `.github/workflows/verify.yml`에 중복 실행 취소, 20분 제한, 수동 실행 이벤트와 단계별 이름을 추가했다. CI 권한은 `contents: read`이며 실제 Firebase/Netlify 비밀값 없이 demo 빌드·에뮬레이터만 사용한다.
- 로컬 린트 통과(기존 경고 있음), YAML 구문 확인, 소스 338개에서 알려진 실제 서버 비밀값 검출 0건. 업로드 후보 변경 103개와 파일 해시는 `artifacts/ci-2026-09-13/preflight.json`에 기록했다. 이후 Git 커밋·push와 원격 CI 실행을 완료했으며, 최신 Verify run `35186294695`(commit `074bf12`)에서 회귀 98개를 포함한 검증이 성공했다.
- 운영 Netlify의 저장소/브랜치 자동 배포 설정을 읽으려던 요청이 **자동 승인 검토의 Codex 사용량 한도 초과**로 거부됐다. 안내된 재개 시각은 **2026-09-14 03:41 KST**다. Netlify 유료 요금제 필요나 GitHub 권한 부족이 아니다. 이 조회를 다른 경로로 우회하지 않았다.

1. 원격 GitHub CI 검증은 완료됐다. `.github/workflows/verify.yml`은 실제 저장소에서 회귀·타입·린트·demo 빌드·Firestore Emulator 검사를 수행한다. 이후 변경은 push마다 같은 검증을 다시 통과해야 한다. 기존 저장소의 Netlify 자동 배포와 GitHub CI 검증은 별도 흐름으로 유지한다.
2. 테스트 앱에서 로그인/비로그인, 기록 페이지, 키보드·광고 복귀 등 실제 화면 확인. **사용자 실기기 확인 필요**. 빌드 성공은 화면 회귀 통과를 뜻하지 않는다.
3. AI·메일·ImgBB·APNs/FCM 실제 연동. **테스트용 키/기기 설정에 사용자 개입이 필요할 수 있음**. 현재 테스트 AI 생성은 비활성이고 외부 서비스 키는 아직 준비하지 않았다. 운영 키를 자동 복사하지 않는다.
4. 운영 백업·복원, 경고 수신, 운영 배포 준비 검토. OTA 기초 작업은 사용자 요청에 따라 병행했고, 실제 OTA 운영 적용은 이 검증과 `OTA_SETUP.md`의 남은 절차 완료 후 진행한다. 이번 테스트 배포를 운영 출시 완료로 해석하지 않는다.

비밀값 저장에 대한 이전 자동 승인 차단은 추가 승인 후 해결됐다. Netlify 유료 계정은 현재 다음 단계의 필수 조건이 아니다. 키 원문을 채팅·문서·검증 로그에 기록하지 않는다.
