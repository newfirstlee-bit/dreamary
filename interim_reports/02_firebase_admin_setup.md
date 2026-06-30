# Interim Report 02: Firebase Integration & Admin Setup

## Context
초기 정적(Static) MVP 구조에서 벗어나, 파이어베이스(Firestore) 연동과 어드민(Admin) 대시보드 구축을 완료함.
사용자는 Imgbb API를 제공하여 이미지 파일 자동 업로드를 구성했으며, 어드민 화면은 PC 데스크톱 환경에 맞게 좌측 사이드바 레이아웃으로 개편됨.

## Actions Taken
1. **Firebase 초기화**: `.env.local` 세팅 및 `src/lib/firebase.ts`, `src/lib/db.ts` 작성.
2. **동적 라우팅 구현**: `src/app/page.tsx` (메인 홈), `src/app/customize/[id]/page.tsx` (커스터마이징 진입로)를 Firestore와 연동.
3. **어드민 페이지 개발**: `src/app/admin/layout.tsx` (데스크톱 레이아웃), `src/app/admin/characters/page.tsx` (Imgbb 파일 업로드 연동)
4. **기존 정적 파일 제거**: `src/lib/data.ts` 삭제.

## Implications & Next Steps
사용자가 대규모 구조 변경(작품-Universe 도입, 캐릭터 6개 성격 슬라이더 추가, 어드민 모바일 미리보기 패널 등)을 요청함.
단순 문답(QnA) 기능으로 넘어가기 전, Firestore 스키마(`universes` 추가) 및 전반적인 UI 컴포넌트 재설계(Phase 3)가 선행되어야 함.
