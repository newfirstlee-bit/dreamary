# 해야 할 일

## 운영 배포 진행 — 2026-09-16

- [x] 운영 백업·복원·Google Drive 보관 및 이전 Netlify 배포 ID 확보.
- [x] 회귀 검사 97개, Rules Emulator 7개, 합성 백업 복원 1개 통과.
- [x] 운영 인덱스 15개 READY 재확인. 일기 367·채팅 6,320·캐릭터 135·계정 25개 모두 양수 숫자 `createdAt` 보유(count 집계 비교, 날짜 수정 없음).
- [x] 기존 주제 185개로 `topicCatalog/current` 생성 및 재조회 확인.
- [x] 운영 ImgBB 키 재등록: 사용자가 운영 등록을 명시적으로 허용했고 기존 운영·스테이징의 동일 키로 `IMGBB_API_KEY`를 등록했다. 무료 요금제의 전체 scope를 사용하되 `NEXT_PUBLIC_` 없이 서버 코드에서만 참조한다.
- [x] 분리된 운영 소스에서 의존성 설치·Netlify 서버/웹 빌드 통과. 운영 게시 전 후보는 `artifacts/production-2026-09-16/release-candidate.json` 참조.
- [x] Netlify 운영 게시 → 호환 Firestore 규칙 적용 → 합성 API 점검 완료. 활성 운영 배포 `6aaa99386e0661bc90373005`; Firestore 규칙 `032b0b1b-7015-4a5a-8969-695dc8ff419c`. 로그인·권한 거부·페어 5개 제한·이미지·선톡·채팅·일기 저장을 합성 데이터로 확인하고 정리했다. 비밀번호 찾기 canonical 404는 연결 경로를 보완해 재배포 후 OPTIONS 204와 미존재 합성 계정 JSON 404를 확인했다.
- [ ] 운영 release `1.0.0` build 7 재생성. build 6의 iOS 첫 실행 흰 화면 원인은 수정·시뮬레이터 검증했고 Android 서명 AAB까지 준비했다. iOS 실기기 Archive는 Codex 사용량 제한으로 남아 있으며 build 6은 심사에 사용하지 않는다.
- [ ] TestFlight 내부 설치 확인. 연결된 iPhone의 통신이 끊겨 로컬 덮어쓰기 설치는 보류했다.
- [ ] Google Play 내부 테스트 업로드. 서명 AAB는 `artifacts/release-2026-09-17/dreamary-1.0.0-7.aab`로 준비됐고 SHA-256은 VERSIONING.md에 기록했다. 최초 업로드 전에 저장소 밖 업로드 키를 별도 보관해야 한다.
- [ ] 양 플랫폼 내부 테스트 최종 확인 후 App Store·Google Play 심사 제출.
- 일반 사용자 대상 비밀번호 재설정 메일은 발신 도메인 인증이 남아 있다. 현재 사용자 결정대로 Resend 테스트 발신 방식을 유지한다.

## 출시 전 비로그인 정보 보존 보완 — 코드 반영, 실기기 확인 필요

- [x] 비로그인 ID·인증키를 네이티브 Preferences에 보조 저장하고 앱 시작 전에 복원한다.
- [ ] 기존 사용자 자격의 안전한 이전과 OTA 전후·로그인/로그아웃·백업 이전 회귀를 확인한다.
- [ ] 조회 실패를 빈 페어 목록으로 표시하지 않도록 보존된 목록과 재시도 UI를 보완한다.
- 예상: 원인 조사·구현·양 플랫폼 검증 12~24시간. 별도 유료 서비스는 기본안에 불필요.
- 2026-09-16 구현 완료: `src/lib/guestPersistence.ts`, `auth.ts`, `guestSession.ts`, 앱 시작 순서를 반영했다. 실기기 회귀는 OTA13 적용 후 진행한다.

## 운영 외부 설정 — 직접 개입 필요

- [x] 운영 Firestore 인덱스 15개 생성 및 READY 확인(2026-09-16).
- [x] Firebase Spark 유지·사용량 수동 확인 결정. Netlify 비용 알림도 추가하지 않는다.
- [x] 운영 Firestore 암호화 백업 생성·로컬 무결성 확인: 2026-09-16 `backups/dreamary-1a9af-20260916T080558Z.drmbkp`, 7,315문서, 2,502,671바이트. 사용자 터미널 `verified:true`, 로컬 파일 존재/권한/체크섬 확인.
- [x] 실제 운영 사본의 격리 DB 복원·전체 내용 대조 완료: 2026-09-16 21:46 KST, 7,315문서, `verifiedEveryDocument: true`, 원본 체크섬 일치. 결과는 백업 옆 `.restore-check.json`. 78문서 후 JSON 해석 실패는 공통 UTF-8 읽기 경로 적용 후 같은 사본으로 재시험 통과(운영 DB 수정 없음).
- [x] Google Drive 보관: `Dreamary 운영백업` 폴더에 운영 암호화 파일 업로드 완료. 파일 ID `103RbfkLkVmxtxxJtvYPo-dcrZun7flXW`, 일반 액세스 제한됨·소유자 1명 확인. 암호문구는 업로드하지 않았다. https://drive.google.com/drive/folders/1zJVkNcR-4y8TkB90ZeYWL2aWTaNxjj8O
- [x] GitHub 저장소에 `.github/workflows/verify.yml`을 push해 원격 CI 1회 실행(Verify run `35065744619`, success). 보호 규칙 연결은 GitHub 저장소 설정에서 별도 결정.
- [ ] iOS·Android 알림 권한이 허용된 실기기에서 실제 푸시 도착을 확인.

완료된 외부 설정:

- [x] 운영 Netlify `IMGBB_API_KEY` 등록 완료. 운영 이미지 API 실제 업로드 확인은 신규 배포 후 진행한다.
- [x] OTA14 테스트 호스팅 게시 및 manifest sequence 19 확인.
