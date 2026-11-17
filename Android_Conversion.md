# MAITE 안드로이드 하이브리드 앱 전환 계획

작성 기준: 2026-11-17. 최초 전환 계획이며, 후속 구현으로 Capacitor 8, `apps/mobile` 번들, Android 프로젝트, 공통 API 클라이언트·CORS와 계정 기능을 추가했다. 실제 연결·실행 절차와 남은 검증은 [설정 안내](docs/ANDROID_ACCOUNT_SETUP.md)를 기준으로 한다. APK 배포와 실기기 검증은 아직 수행하지 않았다.

## 1. 권장 방향

**Capacitor로 React 화면을 안드로이드 앱에 번들하고, 기존 Next.js/Vercel API는 서버로 유지한다.** 캐릭터 생성·대화·이야기·갤러리를 우선 전환한다. 기존 웹 서비스는 계속 제공하고 공통 UI와 모델 호출 로직을 재사용한다.

```text
Android 앱
  Capacitor 네이티브 셸
    번들된 React 화면 + Android 기능 어댑터
                │ HTTPS / SSE / multipart
                ▼
기존 Next.js 서버 / Vercel
  /api/chat          대화·소설·기억·시간선
  /api/characters    이미지 설명·생성·sharp 처리
  /api/generations   CAD 기술 검증용, 후순위
                │ 서버 전용 키
                ▼
            OpenAI API

추후: 서버 ↔ Supabase DB/Storage ↔ 예약 작업/FCM 푸시
```

| 구성 | 판단 | 이유 |
|---|---|---|
| 앱에 정적 화면 번들 + 원격 API | 출시용 권장 | 서버 기능을 유지하면서 네이티브 저장·공유·푸시를 확장하기 좋음 |
| 배포 웹사이트 주소를 WebView에서 그대로 열기 | 짧은 내부 실험용 | 기존 화면을 빠르게 확인할 수 있지만 네트워크·브리지·배포 경계가 불명확해짐 |
| 순수 네이티브 또는 React Native로 전면 재작성 | 현재 우선순위 아님 | 현재 React DOM/CSS 화면을 그대로 재사용하기 어려워 작업 범위가 커짐 |

Capacitor의 `server.url`은 공식적으로 live reload용이며 운영용으로 권장되지 않는다. 출시 구조를 이 옵션에 의존하지 않는다. 외부 주소로 이동 가능한 범위를 넓히는 설정도 개발 편의 목적으로 상시 허용하지 않는다. [Capacitor 설정 문서](https://capacitorjs.com/docs/config)

## 2. 현재 프로젝트에서 그대로 묶을 수 없는 부분

| 현재 구현 | 전환 작업 |
|---|---|
| Next.js 16.4.6, React 19, App Router | 모바일 정적 진입점과 라우터를 분리하고 공통 화면 재사용 |
| `app/api/*`의 POST Route Handler | APK가 아닌 기존 서버에서 실행 |
| Node 전용 `sharp`, `fs`, 서버 키 | 모바일 번들에 포함하지 않음 |
| `next/link`, `next/navigation` | 모바일 라우터 어댑터로 감싸거나 화면 셸에서 교체 |
| 상대 경로 `fetch('/api/...')` | 환경별 API 주소를 선택하는 공통 클라이언트 도입 |
| 동일 Origin만 허용하는 API | 앱 Origin 허용 목록과 OPTIONS/CORS 처리 추가 |
| 대화·소설의 SSE 스트리밍 | Android WebView에서 청크 수신·중단·복귀 실기기 검증 |
| 이미지 Blob 응답 + 메타데이터 헤더 | Blob 수신 유지, CORS에서 필요한 헤더 노출 |
| Blob URL 기반 이미지·갤러리 | 저장 대상은 실제 파일로 보관하고 재실행 시 URL 재생성 |
| `<a download>`로 JPG/CSV/STEP 저장 | Android 파일 저장·공유 어댑터 구현 |
| React 메모리와 sessionStorage 중심 상태 | 재실행 복구가 필요한 상태를 선별해 영속 저장 |

현재 루트에 단순히 `output: 'export'`를 추가하는 것으로 끝낼 수 없다. 설치된 Next.js 문서에서도 Request에 의존하는 Route Handler, 서버 리다이렉트·헤더 등은 정적 내보내기에서 지원하지 않는다. 현재 `next.config.ts`의 서버 헤더, 루트 이동 처리, `/api/*`를 분리해야 한다.

근거: `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`의 Unsupported Features 절 및 현재 `next.config.ts`.

## 3. 제안하는 코드 배치

처음부터 저장소 전체를 옮기지 않고, 모바일 셸을 추가한 뒤 필요한 모듈부터 분리한다. 아래 경로는 **신규 제안**이며 아직 존재하지 않는다.

```text
app/                         기존 웹 라우트와 Vercel API 유지
components/                  기존 화면, 단계적으로 공통 UI로 정리
lib/chat/                    대화 표시·기억·시간선 등 공통 도메인
lib/novel/                   클라이언트 상태와 서버 생성 코드의 경계 정리
apps/mobile/                 React/Vite 등 정적 번들이 가능한 모바일 셸
  src/                       모바일 라우팅·플랫폼 어댑터
  capacitor.config.ts
  android/                   Capacitor가 생성하는 네이티브 프로젝트
packages/                    공통 UI/도메인/플랫폼 계약, 필요 시 도입
```

- 모바일 빌드에서 저장소 외부 소스와 `@/` 경로를 가져오는 방법을 먼저 검증한다. 공통 패키지를 도입한다면 workspace·의존성·CSS 스캔 경로를 함께 설정한다.
- `CharacterStudio.tsx`의 라우터 호출을 화면 이동 인터페이스로 분리한다. 기능 전체를 복사해 웹/앱의 서로 다른 구현으로 방치하지 않는다.
- 모델 호출, 서버 환경변수, 서버 전용 파일 접근을 클라이언트 의존 그래프에서 제거한다. 공통 상태 타입을 가져오다가 `generateChapter` 같은 서버 실행 코드를 번들하지 않도록 모듈 경계를 점검한다.
- 앱 셸은 네트워크 없이도 시작 화면·저장한 기록·연결 오류를 보여줄 수 있게 한다. AI 생성 자체는 인터넷이 필요하다.
- CAD는 기존 기술 검증 범위를 유지한다. 첫 앱의 필수 기능으로 확장하지 않으며 포함할 경우 Worker/WASM·메모리·파일 저장을 별도 검증한다.

## 4. API 연결과 보안: 초기 핵심 작업

### 4.1 공통 API 클라이언트

- 웹: 기존 동일 Origin API 사용을 기본으로 유지한다.
- 앱: 고정된 운영 HTTPS API 주소를 빌드 설정에서 주입한다. 예: `https://<운영 도메인>/api/chat`.
- JSON 대화, multipart 이미지, Blob 응답, SSE를 같은 주소 선택 정책으로 처리한다.
- `lib/usage-store.ts`의 사용량 추적과 실패 사용량 기록을 유지한다.
- `.env.local`의 서버 키는 APK·웹 번들·Android 리소스에 넣지 않는다. 앱에 공개되는 환경변수에는 공개 API 주소 등만 넣는다.
- `OPENAI_MODEL`과 이미지 모델 설정은 기존 서버에서 관리한다. 앱 전환 자체로 mini를 다른 모델로 바꾸지 않는다.

### 4.2 Origin/CORS

현재 `app/api/chat/route.ts`, `characters/route.ts`, `generations/route.ts`는 전달된 Origin이 요청 URL의 Origin과 다르면 거절한다. 로컬 번들 앱은 서버와 Origin이 달라 이 검사를 그대로 통과하지 못한다.

1. 실제 선택한 Capacitor 버전·Android 설정으로 앱 Origin을 확인한다. 기본 HTTPS 로컬 Origin과 웹 운영 도메인을 구분한다.
2. 서버 환경변수로 허용 Origin을 명시하고 해당 Origin에만 CORS 헤더를 응답한다.
3. OPTIONS, POST 및 오류 응답에 일관된 CORS 정책을 적용하고 `Vary: Origin`을 설정한다.
4. `Content-Type`, `X-Track-Usage`, 추후 Authorization 등 실제 사용하는 요청 헤더만 허용한다.
5. `X-Token-Usage`와 `X-Character-*` 중 클라이언트가 읽는 헤더를 `Access-Control-Expose-Headers`에 명시한다. 제목·프롬프트·크기·구도 메타데이터 누락을 검사한다.
6. 쿠키 인증을 나중에 선택하면 SameSite·credentials·CORS 정책을 다시 맞춘다. 지금부터 임의로 쿠키 인증을 추가하지 않는다.

`*` 허용이나 Origin 검사 삭제로 해결하지 않는다. 동시에 **Origin/CORS는 앱 사용자 인증이나 전역 과금 제한이 아니다.** 인증 없는 현재 MVP를 그대로 공개 APK로 배포하면 비용 악용을 막기 어렵다. 출시 단계에서는 공통 저장소 기반 요청 제한·일일 예산·동시 실행 예약/정산을 준비한다. 로그인은 기존 방침대로 별도 도입 결정 이후 적용한다.

Capacitor의 기본 Android scheme 등은 선택한 버전의 [설정 문서](https://capacitorjs.com/docs/config)와 실기기 요청으로 확인한다.

### 4.3 스트리밍과 수명 주기

- 우선 WebView의 표준 `fetch` + `ReadableStream`을 유지해 SSE 청크가 실제로 도착하는지 검증한다.
- 네이티브 HTTP 플러그인이 응답을 버퍼링하면 실시간 대화 표시가 사라질 수 있다. CORS를 피하려고 전체 요청을 무조건 네이티브 HTTP로 교체하지 않는다.
- 현재 서버 대화 시간 제한 150초, 클라이언트 160초, 이미지 대기 280초와 실제 Vercel 요금제/배포 제한을 대조한다. 앱이 오래 기다릴 수 있어도 서버 실행 시간이 늘어나는 것은 아니다.
- 첫 버전은 백그라운드 전환 시 생성 중단을 기본안으로 한다. 완료되지 않은 대사·회차·기억·시간선을 성공 기록으로 확정하지 않는다.
- 복귀 시 생성 결과를 자동 재요청하지 않는다. 사용자가 재시도하도록 하고, 추후 작업 ID/서버 저장을 도입하면 먼저 기존 결과를 조회한다.
- 통신이 끊겼어도 서버에서 토큰을 이미 사용했을 수 있다. 미수신 사용량을 0으로 처리하지 않고 중복 생성 방지를 설계한다.

앱 상태 변경·딥링크·뒤로가기 처리는 [Capacitor App API](https://capacitorjs.com/docs/apis/app)를 기준으로 구현한다.

## 5. 이미지 저장·공유·상태 보존

### 5.1 파일 처리

- WebView의 Blob URL은 현재 실행에서 표시하는 용도다. DB나 영속 상태에는 Blob URL 문자열을 저장하지 않는다.
- 이미지 원본은 앱 전용 파일 또는 추후 Storage에 저장하고 파일 ID/경로·제목·종류·구도 계획을 기록한다. 기존 24장 한도와 파일 정리 정책을 함께 유지한다.
- ‘앱 내부 보관’, ‘다른 앱으로 공유’, ‘사진/다운로드 폴더로 내보내기’를 구분한다.
- 기존 Blob 응답은 앱 전용 파일에 쓴 뒤 Share로 공유할 수 있다. 공개 사진 저장은 MediaStore, 사용자 지정 문서 저장은 SAF 등의 네이티브 연동을 선택해 검증한다. 임의로 광범위 저장소 권한을 요구하지 않는다.
- CSV도 네이티브 저장·공유 대상으로 포함한다. CAD를 포함하면 STEP/JSON도 같은 어댑터를 사용한다.
- Filesystem의 구형 `downloadFile`을 새 구현 기준으로 삼지 않는다. 원격 파일 전송이 필요할 때는 File Transfer를 검토한다. 현재 Blob 응답을 받는 경로에는 무조건 별도 다운로드 호출을 추가하지 않는다.

참고: [Filesystem](https://capacitorjs.com/docs/apis/filesystem), [File Transfer](https://capacitorjs.com/docs/apis/file-transfer), [Share](https://capacitorjs.com/docs/apis/share).

### 5.2 앱 재실행 복구

| 저장 대상 | 초기 권장안 |
|---|---|
| 캐릭터 프로필·완료된 대화/소설·공통 시간선 | 로컬 DB 등 구조화 저장, 버전/마이그레이션 포함 |
| 이미지 | 파일 저장 + 메타데이터 참조 |
| 배경 선택·‘배경 없음’ | 작은 환경설정 저장 |
| 사용량 계측 | 기존 최근 300개 한도를 유지한 앱 저장 어댑터 |
| 미완료 응답·실행 중 요청 | 성공 결과로 복원하지 않음 |
| 키·향후 로그인 자격 증명 | APK에 서버 키 없음; 인증 도입 시 안전한 저장 방식 별도 설계 |

로컬 DB는 앱 기기의 저장소다. 서버 로컬 JSON 파일을 DB처럼 쓰지 않는 기존 방침과 다르며, 서버의 사용자별 공유/복구에는 추후 Supabase 같은 공통 저장소가 필요하다. 큰 대화/이미지를 단순 Preferences에 몰아넣지 않는다. Android의 프로세스 종료 시 마지막 저장된 일관된 revision을 복원하도록 트랜잭션과 저장 시점을 정한다.

현재 웹은 새로고침 시 기록 초기화가 기본이다. 앱에서는 재실행 보존을 권장하지만, 웹 동작까지 자동 변경하지 않고 플랫폼별 정책으로 분리한다. 저장된 데이터 삭제·저장 실패·용량 부족도 UI에서 처리한다.

## 6. Android 화면과 조작

- 뒤로가기 우선순위: 이미지 확대 닫기 → 배경 선택 닫기 → 앱 내부 이전 화면 → 루트에서 종료 동작.
- 시스템 뒤로가기와 브라우저 라우터가 동시에 처리해 두 화면씩 이동하지 않도록 한다.
- 키보드 표시/숨김, 한글 조합 입력, 입력창 가림, 스크롤 위치, 상태 바·내비게이션 바·화면 가장자리 여백을 실기기로 확인한다.
- 이미지 확대/가로세로 회전/프로세스 재생성 시 배경 선택과 대화 읽는 위치를 복구한다.
- 외부 링크는 시스템 브라우저로 열고 허용하지 않은 주소에 네이티브 브리지를 노출하지 않는다.
- 기본 권한은 필요한 네트워크 기능부터 시작한다. 푸시·사진 접근 등은 기능이 실제로 준비된 단계에서 최소 범위로 요청한다.
- 오프라인·서버 오류·시간 초과·중단·모델 제한을 현재의 오류 처리 흐름과 연결한다.

## 7. 개발 환경과 앱 생성 절차

2026-11-17 공식 Capacitor 8 가이드 기준 Node.js 22 이상, Android Studio 2025.2.1 이상을 준비한다. 해당 가이드의 Android 기본값은 min SDK 24, compile/target SDK 36이다. 설치 시점에는 선택 버전의 SDK·Gradle·JDK 호환성을 다시 확인하고 Android Studio의 호환 JDK 설정을 따른다. [Capacitor 8 전환 가이드](https://capacitorjs.com/docs/updating/8-0), [환경 설정](https://capacitorjs.com/docs/getting-started/environment-setup).

아래는 **모바일 셸이 준비된 뒤 `apps/mobile`에서 실행할 예시**다. 지금 루트에서 실행하거나 기존 Next.js 빌드 결과를 그대로 webDir로 지정하지 않는다. 관련 패키지는 동일한 호환 메이저로 고정하고 lockfile을 관리한다.

```powershell
npm install @capacitor/core@8 @capacitor/android@8
npm install -D @capacitor/cli@8
npx cap init
# 앱 이름/고유 패키지 ID를 결정하고 webDir을 실제 정적 출력 폴더로 지정
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

`npm run build`는 모바일 셸의 정적 번들을 생성하는 스크립트여야 한다. Vite를 선택하면 보통 `dist`이지만 실제 설정을 기준으로 한다. Android 프로젝트 생성 이후에는 웹 빌드 → `cap sync android` → Android 빌드 순서로 반복한다. 운영 빌드에는 개발용 `server.url`, cleartext 허용, 개발 서버 IP, 서버 비밀키가 없어야 한다.

## 8. 추후 구글 로그인·DB·먼저 말 걸기·푸시

**안드로이드 전환과 별도 단계**로 진행한다. 현재 인증 없는 MVP에 이번 계획만으로 로그인을 추가하지 않는다.

1. 사용자·기기·캐릭터 ID를 정하고 계정 연동 및 안전한 데이터 접근 정책을 설계한다.
2. 구글 로그인은 시스템 브라우저/네이티브 인증과 앱 복귀 링크를 설계한다. 단순 WebView 안에서 로그인 페이지를 여는 방식으로 확정하지 않는다.
3. DB에 완료 메시지·공통 시간선·마지막 사용자 대화 시각·기기 푸시 토큰·알림 동의·발송 시각을 저장한다.
4. 서버 예약 작업이 일정 기간 미대화 여부와 하루 한도·야간 금지 시간·미응답 상태를 확인한다. 확인 자체에는 LLM을 쓰지 않는다.
5. 조건을 통과한 경우에만 캐릭터 메시지를 생성하고 DB에 먼저 저장한다. 중복 예약/중복 발송을 방지한다.
6. FCM으로 표시용 푸시를 보내고 알림 클릭 시 사용자에게 허용된 캐릭터 대화방의 저장 메시지를 연다.
7. 기기 토큰 갱신·로그아웃·기기 변경·알림 거절·전달 실패를 처리한다. 앱 백그라운드 JavaScript 타이머에 발송을 맡기지 않는다.
8. 실제 선제 메시지가 제공되기 전까지 `lib/chat/capabilities.ts`의 ‘먼저 연락할 수 없음’을 유지한다. 구현 후에만 실제 가능한 범위와 사용자 설정을 반영해 지시를 바꾼다.

Android 푸시는 [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)를 기준으로 별도 검증한다. 푸시 표시와 앱의 백그라운드 코드 실행은 구분하며, 정확한 시각의 도착을 보장하는 기능으로 설명하지 않는다.

## 9. 구현 순서와 완료 기준

| 단계 | 작업 | 통과 기준 |
|---|---|---|
| 0. 방향 확정 | 앱 ID, 최소 지원 기기, API 운영 주소, 저장 정책 결정 | 웹 유지/앱 번들/서버 책임이 분리됨 |
| 1. 구조 분리 | 모바일 셸, 공통 UI/라우터·플랫폼 경계 | 로컬 번들 화면이 APK에서 시작됨; 서버 코드·키가 번들에 없음 |
| 2. API 연결 | API 클라이언트, CORS/Origin, SSE, 이미지 헤더 | 실기기 대화가 점진 표시되고 이미지 생성·사용량 기록이 정상 |
| 3. 앱 조작 | 뒤로가기, 키보드, 확대·갤러리, 파일 저장/공유 | 기기별 핵심 흐름·취소·다운로드 통과 |
| 4. 복구 | 로컬 저장, 파일 관리, revision·마이그레이션 | 강제 종료 후 마지막 완료 상태 복구, 미완료 결과 미확정 |
| 5. 배포 준비 | 운영 제한, 신고/개인정보 안내, 서명·AAB | 내부 배포 빌드를 실기기에서 설치·업데이트 검증 |
| 후속 | 로그인·클라우드 저장·푸시 | 별도 요구와 테스트로 도입 |

첫 검증 범위는 **캐릭터 1개 생성 → 대화 → 이야기 → 공통 시간선 반영 → 이미지 생성 → 갤러리 저장·공유 → 배경 없음 → 재실행 복구**로 한다. 전환과 동시에 모델 변경·문맥 축소·광고·결제·iOS 지원까지 묶지 않는다.

## 10. 검증 체크리스트

- [ ] 기존 웹의 typecheck·단위 테스트·Playwright·프로덕션 빌드 통과.
- [ ] Android emulator와 최소 한 대의 실제 기기에서 release 빌드 확인.
- [ ] 서버 웹 Origin은 정상, 앱 Origin은 정상, 허용하지 않은 Origin은 차단.
- [ ] OPTIONS, 오류 응답, 이미지 메타데이터, SSE 사용량 이벤트 정상.
- [ ] 대화 1회·소설 기본 3회/재작성 최대 5회의 기존 모델 호출 구조 유지.
- [ ] 화면 이동/복귀/키보드/연속 클릭/네트워크 전환으로 중복 생성하지 않음.
- [ ] 실패·취소·이전 revision 결과가 기억·시간선·갤러리에 성공으로 저장되지 않음.
- [ ] 프로세스 종료 후 완료 기록·실제 이미지 파일·배경 없음 선택 복구.
- [ ] 파일 저장·공유 취소·용량 부족·공유 대상 앱 없음 처리.
- [ ] APK/AAB 및 소스맵·로그에 서버 키나 대화 원문이 불필요하게 포함되지 않음.
- [ ] 앱 업데이트 시 기존 데이터 마이그레이션·손상 데이터 복구 확인.
- [ ] CAD 포함 시 WebGL/Worker/WASM 로딩과 STEP 저장을 별도 통과.

## 11. 배포 준비와 운영 비용

- 테스트용 APK와 Play 배포용 서명 AAB를 구분한다. 패키지 ID·버전 코드·업로드 키 보관·앱 서명을 준비한다.
- 현재 Android 공식 안내의 일반 신규 앱/업데이트 기준은 Android 16(API 36) 이상이다. 실제 업로드 직전 Play Console의 적용 대상·기한을 다시 확인한다. [Target API 요구사항](https://developer.android.com/google/play/requirements/target-sdk)
- AI 채팅·이미지 생성 앱에 해당하므로 부적절한 결과를 앱 안에서 신고할 수 있는 기능과 처리 경로를 배포 범위에 넣는다. 현재 미성년 성적 콘텐츠 차단만으로 모든 출시 요건이 완료됐다고 보지 않는다. [Google Play AI 생성 콘텐츠 정책](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en)
- 실제 수집/보관/전송하는 프로필·대화·이미지·푸시 토큰에 맞춰 개인정보 안내, 데이터 보안 설문, 연령/콘텐츠 등급을 작성한다. 로그인/계정 생성 추가 시 계정·데이터 삭제 흐름도 함께 검토한다.
- 하이브리드 앱으로 포장하는 것 자체는 OpenAI 토큰을 늘리지 않는다. 중복 요청·자동 재시도·복귀 시 재생성이 소비량을 늘릴 수 있으므로 요청 ID와 완료 처리부터 점검한다.
- 클라우드 저장·선제 메시지·푸시를 추가하면 저장/트래픽/예약 작업과 메시지 생성 비용이 별도로 생길 수 있다. 초기 전환 비용과 분리해 측정한다.

## 12. 첫 구현에서 수정할 파일 후보

| 파일/영역 | 작업 |
|---|---|
| `components/CharacterStudio.tsx` | Next 라우터/화면 셸과 공유 세션 분리 |
| `components/LiveChat.tsx` | API 클라이언트·앱 수명 주기·복구 어댑터 연결 |
| `components/useCharacterGallery.ts` | 파일 저장·복원과 Blob URL 수명 관리 |
| `components/CharacterGallery.tsx`, `CharacterImage.tsx` | Android 저장/공유와 확대 닫기 연동 |
| `lib/usage-store.ts` | 플랫폼 저장소·CSV 내보내기 추상화 |
| `lib/chat/session.ts`, `timeline.ts`, `lib/novel/state.ts` | 완료 상태의 직렬화·버전·복구 정책 |
| `app/api/chat/route.ts`, `characters/route.ts`, `generations/route.ts` | 공통 Origin/CORS, 오류 헤더, 향후 비용 제한 |
| `next.config.ts`, 루트 패키지/빌드 설정 | 웹 서버 유지, 모바일 빌드/공통 패키지 경계 정리 |
| 신규 모바일 설정/Android 프로젝트/CI | 번들·서명·실기기 검사, 빌드 산출물/키 제외 규칙 |

**다음 실행 작업은 1단계의 작은 Android 검증 앱을 만드는 것**이다. 운영 서버 주소와 앱 로컬 Origin을 확인하고, 정적 화면 1개에서 기존 대화 API의 SSE를 수신하는 것까지 먼저 통과한 뒤 전체 화면을 옮긴다.
