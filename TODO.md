# 해야 할 일

## 출시 전 비로그인 정보 보존 보완 — 코드 반영, 실기기 확인 필요

- [x] 비로그인 ID·인증키를 네이티브 Preferences에 보조 저장하고 앱 시작 전에 복원한다.
- [ ] 기존 사용자 자격의 안전한 이전과 OTA 전후·로그인/로그아웃·백업 이전 회귀를 확인한다.
- [ ] 조회 실패를 빈 페어 목록으로 표시하지 않도록 보존된 목록과 재시도 UI를 보완한다.
- 예상: 원인 조사·구현·양 플랫폼 검증 12~24시간. 별도 유료 서비스는 기본안에 불필요.
- 2026-09-16 구현 완료: `src/lib/guestPersistence.ts`, `auth.ts`, `guestSession.ts`, 앱 시작 순서를 반영했다. 실기기 회귀는 OTA13 적용 후 진행한다.

## 운영 외부 설정 — 직접 개입 필요

- [x] 운영 Firestore 인덱스 15개 생성 및 READY 확인(2026-09-16).
- [ ] 오류/비용 알림 수신 이메일과 월 예산·알림 임계값을 정해 Firebase·Netlify 콘솔에 등록.
- [ ] 암호화 백업의 별도 보관 위치·백업 암호문구·복원 담당자를 정해 실제 운영 백업과 복원 리허설 수행.
- [ ] GitHub 저장소에 `.github/workflows/verify.yml`을 push해 원격 CI 1회 실행하고 보호 규칙에 연결.
- [ ] iOS·Android 알림 권한이 허용된 실기기에서 실제 푸시 도착을 확인.

완료된 외부 설정:

- [x] 운영 Netlify 기존 ImgBB 키를 secret `IMGBB_API_KEY`로 이전하고 공개 `NEXT_PUBLIC_IMGBB_API_KEY` 제거.
- [x] OTA14 테스트 호스팅 게시 및 manifest sequence 19 확인.
