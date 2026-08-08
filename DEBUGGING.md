# Dreamary 모바일 디버깅 기록

같은 장애가 반복되지 않도록 실제 기기에서 확인된 원인과 금지 설정을 기록한다.

## 2026-08-08 정적 앱 상세 화면이 즉시 목록으로 복귀

### 증상

- 채팅 목록에서 실제 채팅방을 열면 잠깐 로딩된 뒤 채팅 목록으로 돌아감
- 일기 모아보기에서 일기를 선택하면 상세 대신 모아보기 목록으로 돌아감

### 원인

- Capacitor 정적 빌드는 물리 페이지 `/chat/1`, `/diary/history/1`을 재사용하고 실제 문서 ID는 `entityId` query에 담음
- 상세 컴포넌트가 렌더 중 `window.location.search`를 직접 읽어, Next.js 소프트 이동에서 주소 갱신 전 빌드용 ID `1`을 사용함
- Firestore에서 ID `1` 문서를 찾지 못하자 기존 보호 로직이 목록으로 이동시킴

### 수정 및 필수 규칙

- 상세 페이지는 `useSearchParams()`로 `entityId` 변경을 구독한다.
- 정적 출력에서 `useSearchParams()`를 쓰는 상세 페이지는 `Suspense` 경계 안에서 렌더한다.
- 실제 문서를 확인하기 전에는 빌드용 ID `1`로 Firestore를 조회하거나 목록으로 리다이렉트하지 않는다.
- 같은 물리 상세 경로에서 이전·다음 항목으로 이동할 때도 query 변경으로 데이터를 다시 불러와야 한다.

### 회귀 확인

1. 앱 채팅 목록에서 서로 다른 캐릭터 채팅방을 차례로 열어 각각 유지되는지 확인한다.
2. 일기 모아보기에서 일기 상세로 진입한 뒤 이전·다음 일기로 이동한다.
3. 어떤 상세 화면도 진입 직후 목록으로 자동 복귀하지 않는지 확인한다.

## 2026-08-06 Android 캐릭터 저장 시간초과

### 증상

- 비로그인 상태에서 캐릭터 생성을 완료하면 `캐릭터 저장 시간이 초과되었습니다.`가 표시됨
- 15초 제한시간을 늘려도 해결되지 않음
- 저장 버튼 재시도 시에도 같은 오류 반복

### 실제 저장 여부

- 오류가 발생한 비로그인 UUID로 Firestore `characters`를 직접 조회한 결과 문서 수는 0개였음
- 서버가 쓰기를 확정하기 전 통신 스트림이 끊겼으므로 캐릭터는 저장되지 않았음

### 확인 로그

```text
CapacitorHttp ... firestore.googleapis.com/.../Firestore/Write/channel ... status 200
@firebase/firestore: WebChannelConnection RPC 'Write' ... transport errored
Error: 캐릭터 저장 시간이 초과되었습니다.
```

HTTP 200은 저장 완료가 아니라 Firestore 스트리밍 채널의 최초 연결 응답이다. 그 뒤에 와야 하는 쓰기 완료 응답을 받지 못했다.

### 원인

- `capacitor.config.ts`에서 `CapacitorHttp.enabled: true`로 전역 `fetch`와 `XMLHttpRequest`를 네이티브 HTTP로 교체함
- Firestore Web SDK는 여러 응답을 이어 받는 WebChannel 스트림을 사용함
- CapacitorHttp는 응답을 한 번에 버퍼링하고 종료된 일반 HTTP 응답으로 반환하여 Firestore 스트림이 매번 끊김
- Firestore가 내부 재시도를 계속하므로 `setDoc()` Promise가 끝나지 않았고 앱의 15초 제한시간이 먼저 종료됨

### 수정 및 필수 규칙

- `CapacitorHttp.enabled`는 iOS와 Android 모두 `false`로 유지한다.
- Firestore는 WebView 기본 네트워크와 `experimentalAutoDetectLongPolling`을 사용한다.
- 단순 HTTP 요청에 네이티브 HTTP가 필요하면 전역 패치가 아닌 명시적인 `CapacitorHttp.request()`만 검토한다. Firestore와 스트리밍 채팅 API에는 사용하지 않는다.
- 캐릭터 저장 재시도는 같은 문서 ID를 재사용한다. 타임아웃 직후 원래 요청이 늦게 완료되어도 중복 캐릭터가 생기지 않게 한다.
- 이 설정을 바꾼 뒤에는 반드시 `npm run build:app`, `npx cap sync`, 실제 기기 재설치 순서로 확인한다.

### 회귀 확인

1. Android 실제 기기에서 비로그인 캐릭터를 생성한다.
2. 저장 완료 후 홈·채팅 탭에 같은 캐릭터가 한 번만 노출되는지 확인한다.
3. Firestore에서 해당 UUID의 `characters` 문서와 캐릭터 ID 기반 `users` 문서를 확인한다.
4. Logcat에서 `Firestore/Write/channel` 요청이 CapacitorHttp로 전달되지 않는지 확인한다.
5. `WebChannelConnection RPC 'Write' ... transport errored`가 반복되지 않는지 확인한다.

## 2026-08-06 iOS/AOS 캐릭터 생성 후 선톡 미수신

### 증상

- 캐릭터 저장은 성공하지만 홈과 채팅방에 캐릭터의 첫 메시지가 나타나지 않음
- 앱을 껐다 켜거나 채팅방에 다시 들어가도 재시도되지 않음
- 실제 iPhone 비로그인 데이터 조회에서도 캐릭터 1건, 채팅 메시지 0건으로 확인됨

### 원인

- 네이티브 앱 origin은 `https://localhost`인데 운영 `/api/chat`의 OPTIONS 응답에 `Access-Control-Allow-Origin`이 없어 WebView가 POST 전에 요청을 차단함
- 기존 코드는 API 결과를 받기 전에 `hasPinged_{characterId}=true`를 저장함
- 실제 Firestore 채팅 문서는 0건인데 로컬 플래그만 성공으로 남아 홈·채팅 상세의 재시도를 막음
- 동일 선톡 호출이 온보딩·홈·채팅 상세 세 곳에 중복 구현되어 실패 처리 방식도 서로 달랐음

### 확인 로그 및 운영 응답

```text
Access to fetch at 'https://dreamary.netlify.app/api/chat' from origin
'https://localhost' has been blocked by CORS policy
```

운영 서버에 OPTIONS 요청을 직접 확인했을 때 HTTP 204였지만 CORS 허용 헤더가 없었다.
같은 운영 API에 저장 없는 진단 POST를 직접 보냈을 때는 HTTP 200과 정상 답장이 반환되어 AI 생성 서버 자체는 정상임을 확인했다.

### 수정 및 필수 규칙

- 선톡은 `src/lib/initialPing.ts`의 `ensureInitialPing()`으로만 요청한다.
- 네이티브 선톡은 단발성 JSON 요청이므로 명시적 `CapacitorHttp.post()`를 사용한다. 전역 `CapacitorHttp.enabled`는 계속 `false`다.
- 웹은 동일 출처 fetch를 사용한다.
- `hasPinged_*`는 API가 성공하고 답장 본문을 받은 뒤에만 기록한다.
- 로컬 플래그와 관계없이 Firestore 채팅이 0건이면 선톡을 다시 요청한다.
- 같은 캐릭터의 동시 호출은 하나의 Promise를 공유하며, `requestId`를 고정하여 재시도 중복을 방지한다.
- Netlify `/api/chat`은 `netlify/functions/chat`으로 명시적으로 연결하고 함수가 OPTIONS와 실제 응답 모두 CORS 헤더를 반환하게 한다.

### 회귀 확인

1. 기존에 `hasPinged_*`만 남고 채팅이 없는 캐릭터로 홈 또는 채팅 상세에 진입한다.
2. 선톡 1건이 Firestore `chatMessages`에 저장되고 화면에 표시되는지 확인한다.
3. 홈과 채팅 상세를 빠르게 왕복해도 선톡이 2건 생기지 않는지 확인한다.
4. iOS와 Android에서 각각 새 캐릭터를 만들고 앱 재실행 후에도 선톡이 1건만 유지되는지 확인한다.

## 2026-08-06 iOS 채팅 입력창 하단 공백

### 증상과 원인

- 채팅 상세 입력창이 화면 하단에서 크게 떠 있고 그 아래에 불필요한 빈 영역 또는 하단 탭이 보임
- `.full-page`의 공통 viewport 높이와 인라인 `max-height: -webkit-fill-available`이 동시에 적용되어 WKWebView에서 콘텐츠 높이가 이중으로 제한됨
- 구형 iOS 번들에서는 채팅 상세가 풀페이지라는 중앙 하단 탭 규칙도 반영되지 않아 공백이 더 크게 보였음

### 수정 및 필수 규칙

- 채팅 상세는 `.full-page`의 `--app-viewport-height`만 사용하고 `-webkit-fill-available`을 사용하지 않는다.
- 입력 영역은 `.chat-input-area` 공통 클래스로 하단 안전영역을 한 번만 반영한다.
- 채팅 상세는 풀페이지이므로 하단 탭을 절대 생성하지 않는다.

## 2026-08-06 앱 광고 후 에러 모달

### 증상

- Android에서 광고 웹페이지가 열리지 않음
- iOS에서 광고 웹페이지는 열렸지만 드리머리로 돌아온 뒤 `잠시 후 다시 시도해주세요` 모달이 표시됨
- 재시도 시 두 플랫폼 모두 같은 에러 모달이 반복될 수 있음

### 원인

- 광고 모달 확인 직후 답장 생성 API와 광고 브라우저 호출이 동시에 진행되어, 광고 성공 여부와 드리머리 서버 실패가 같은 에러 흐름으로 섞였음
- 기존 광고 완료 기준이 `window.open()` 또는 `Browser.open()` 호출 시점에 가까워 실제 네이티브 브라우저 열림/복귀 상태를 구분하기 어려웠음
- Netlify 설정에 `/api/chat` 연결만 있고 `/api/diary` 연결이 없어 앱의 일기 답장 API 호출이 배포 환경에서 흔들릴 수 있었음

### 수정 및 필수 규칙

- 광고 대상 턴은 광고 웹페이지가 실제로 열렸을 때만 채팅·일기 답장 API를 호출한다.
- 광고 웹페이지가 열리면 광고는 성공으로 보고 답장을 제공한다. 별도의 클라이언트 잠금해제 저장 실패 때문에 사용자에게 에러 모달을 띄우지 않는다.
- 광고 웹페이지가 열리지 않으면 답장 API를 호출하지 않고 입력값을 보존한다.
- 광고 도메인 접근이 DNS·광고 차단 앱·콘텐츠 차단으로 막힌 것으로 의심되면 `ad_block_suspected`로 기록한다. 이 로그는 서버 전송이 아니라 기기 로컬 `dreamary_ad_diagnostics`에만 남긴다.
- 광고 호출 실패는 `ad_open_failed`, 드리머리 서버/API 실패는 `app_server_request_failed`, 기존 잠금 콘텐츠 해제 실패는 `ad_unlock_failed`로 `dreamary_ad_diagnostics` 로컬 로그에 남긴다.
- Netlify는 `/api/chat`과 `/api/diary` 모두 함수 리다이렉트를 명시한다.

### 회귀 확인

1. 광고 대상 채팅 턴에서 광고 웹페이지가 열리면 앱 복귀 후 답장이 표시되는지 확인한다.
2. `dns.adguard.com` 같은 개인 DNS 차단 환경에서는 사용자 입력이 보존되고 답장 API가 호출되지 않는지 확인한다.
3. iOS와 Android에서 `localStorage.dreamary_ad_diagnostics`에 광고 차단 의심, 광고 열기 실패, 서버 실패가 다른 타입으로 기록되는지 확인한다.

## 2026-08-06 앱 채팅 첫 전송 실패와 일기 임시입력 오염

### 증상

- iOS와 Android에서 첫 채팅 전송부터 `잠시 후 다시 시도해주세요`가 표시되고 답장이 오지 않음
- 일기는 같은 기기에서 정상 동작함
- 채팅 전송에 실패한 문장이 이후 일기 입력란에 자동으로 들어갈 수 있음

### 원인

- 채팅은 광고 턴이 아닐 때 네이티브 앱에서도 웹용 스트리밍 `fetch`를 사용하고 있었음
- 일기는 이미 단발성 JSON API를 사용해 네이티브 CORS/스트리밍 병목을 피하고 있었기 때문에 정상 동작했음
- 채팅 광고 카운트를 API 성공 전에 증가시켜 실패한 전송도 광고 턴 계산에 포함될 수 있었음
- 채팅과 일기가 같은 `dreamary_draft_{characterId}` 임시저장 키를 공유하여 실패한 채팅 입력이 일기 draft로 복원될 수 있었음
- 채팅 메시지를 API 호출 전에 Firestore에 저장한 뒤 실패 시 원격 문서를 삭제하지 않아 구독으로 실패 메시지가 다시 나타날 수 있었음

### 수정 및 필수 규칙

- 네이티브 앱의 일반 채팅 전송은 `preferJsonResponse: true`가 포함된 `apiPostJson('/api/chat')`로 처리한다.
- 웹 채팅은 기존 스트리밍 응답을 유지한다.
- 채팅 광고는 성공한 AI 답장 수 기준으로 3번째, 6번째, 9번째에만 노출한다.
- 광고가 열리지 않거나 서버/API가 실패한 채팅은 광고 카운트를 증가시키지 않는다.
- 채팅 실패 입력은 `chat` scope draft에만 저장하고, 일기는 `diary` scope draft만 읽는다.
- 전송 실패 시 API 호출 전에 저장한 사용자 채팅 문서를 삭제하여 채팅방에는 실패 메시지가 남지 않고 입력칸에만 복원되게 한다.

### 회귀 확인

1. 새 채팅방에서 1번째와 2번째 채팅은 광고 없이 전송되고 AI 답장이 표시되는지 확인한다.
2. 3번째 채팅에서 광고 웹페이지가 열리고, 앱 복귀 후 AI 답장이 표시되는지 확인한다.
3. 3번째 채팅에서 광고가 차단되면 답장 API가 호출되지 않고 입력값이 채팅 입력칸에 남는지 확인한다.
4. 채팅 실패 후 일기 탭에 진입해도 실패한 채팅 문장이 일기 입력란에 자동 입력되지 않는지 확인한다.
