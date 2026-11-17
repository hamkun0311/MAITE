# Android · 계정 · 하트 구현 및 설정

2026-11-17. 이 문서는 소스에 추가된 기능과 실제 운영 전 필요한 설정·검증을 구분한다. 기존 `.env.local`의 OpenAI 모델/키는 변경하지 않았다.

## 구현한 흐름

- 기존 Next 웹 화면과 `apps/mobile`의 React/Vite 화면이 캐릭터·대화·소설·갤러리 컴포넌트를 공유한다. Capacitor 8 Android 프로젝트의 앱 ID는 `com.oestewdio.maite`이다. Next 서버와 OpenAI 키는 앱에 포함되지 않는다.
- 공통 `apiFetch`가 웹에서는 상대 경로, 앱에서는 설정된 HTTPS API를 사용하며 Supabase Bearer 토큰을 전송한다. `/api/chat`, `/api/characters`는 명시적 CORS와 스트리밍을 지원한다. 계정 모드에서 CAD 기술 검증 API는 사용을 차단한다.
- Google 로그인, 잔액/무료 대화, 출석 수령, 현재 작업 저장/불러오기, 작업별 완료 결과 재열람, 콘텐츠 신고 화면을 상단 **계정 · 하트** 메뉴에 추가했다.
- 생성 전에 하트/무료 대화를 예약하고, 완성된 응답·이미지를 서버에 저장한 후 성공을 전달한다. 실패·취소 시 반환하고, 응답 유실 시 계정 메뉴에서 결과를 다시 확인한다. 같은 `X-Request-Id`의 재전송은 AI를 다시 호출하지 않는다. 새 요청 ID로 명시적으로 재시도하면 새 작업이다.
- 서버가 강제 종료돼 남은 예약은 15분 이후 해당 계정 조회 시 반환한다. 생성 서버 최대 실행 시간은 5분 이하로 유지해야 한다. 이미지 업로드 후 DB 확정 실패 시 고아 파일 정리 작업은 운영에서 별도 관리가 필요하다.
- 개인 보관함은 `documents`의 버전 1 스냅샷에 프로필·완료 대화·소설 회차·기억·공통 시간선·현재 캐릭터 갤러리 참조를 저장한다. 실제 이미지와 생성 작업별 결과는 별도 비공개 Storage/DB에 저장된다. 완료 시 자동 저장하고 메뉴에서 수동 저장도 가능하다. 모바일은 Blob을 포함해 IndexedDB에도 보관한다. 웹의 미로그인 탭 기록은 기존처럼 새로고침 시 초기화한다.
- 모바일에서 백그라운드 전환 시 진행 생성을 중지한다. 완료된 내용만 저장하며 자동 재시도하지 않는다. 이미지/토큰 CSV는 네이티브 공유 메뉴로 저장할 수 있다. 뒤로가기는 열린 다이얼로그를 먼저 닫는다.
- 스토어 등록은 공개용 프로필/캐릭터 이미지 또는 선택한 소설 회차 스냅샷만 게시한다. 개인 대화·기억·시간선은 포함하지 않는다. 구매한 캐릭터를 사용할 때 판매자의 세션을 복사하지 않는다. 구매 소설은 재차 차감 없이 읽고, 판매 중지된 구매본도 권한으로 접근한다.

## 확정 정책과 구현 기본값

| 항목 | 적용값 |
|---|---|
| 가입 무료 대화 | 계정 최초 1회, 총 5회. 캐릭터 변경/앱 재설치로 재지급하지 않음 |
| 생성 | 캐릭터 50 / 유료 대화 2 / 소설 회차 15 / 삽화 50 / 대화 이미지 30하트 |
| 내부 검증 | 같은 작업 내 추가 모델 호출은 하트 추가 차감 없음. 실제 OpenAI 사용량은 별도 발생 |
| 출석 | 한국시간 접속 시 1일 1회, 월~토 5 / 일요일 총 15하트 |
| 광고 | 서명된 서버 콜백당 5하트, 계정당 하루 최대 5회 |
| 기간권 | 자동 갱신 없는 일회성 상품, 즉시 100 + 접속한 날 10하트 |
| 캐릭터 판매자 | 판매금액 30 / 수수료 −5 / 총 수령 25 |
| 캐릭터 구매자 | 구매금액 30 / 수수료 +5 / 총 차감 35 |
| 소설 판매자 | 회차 판매금액 10 / 수수료 −2 / 총 수령 8 |
| 소설 구매자 | 회차 구매금액 10 / 수수료 +2 / 총 차감 12 |

세부 구현 기본값: 기간권은 한국시간 구매일을 포함한 30개 날짜에 유효하며 구매 당일도 10하트를 수령할 수 있다. 미접속 날짜의 보상은 누적하지 않고, 활성 기간권 중복 충전은 거절한다. 성공한 생성만 정산하며, 결과가 서버에 저장된 후 연결이 끊기면 완료 작업으로 유지한다. 생성에는 보상 하트를 먼저 사용한다. 광고·출석 하트는 보상 잔액으로 분리해 스토어 구매에 사용할 수 없고, 유료 구매·기간권·판매 수령 하트만 스토어에서 사용한다. 구매 캐릭터도 계정의 남은 무료 대화를 공유한다. 재생성/수정 요청은 이미지 생성 1건으로 취급한다. 이 세부 기본값의 운영 확정은 출시 전에 검토해야 한다.

## 1. Supabase

1. 프로젝트를 만들고 [SQL 마이그레이션](../supabase/migrations/202611170001_accounts.sql)을 적용한다. 로컬 파일 작성만으로 원격 DB가 변경되지는 않는다.
2. Auth → Google 제공자를 설정한다. Google OAuth 콘솔에는 Supabase가 제공하는 callback URL을 등록한다. Supabase Redirect URLs에는 실제 웹 주소의 `/ideal`, `com.oestewdio.maite://auth/callback`을 허용한다. 기본은 PKCE이며 앱은 시스템 브라우저를 사용한다.
3. `.env.example`을 참고해 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`를 설정한다. 공개 키는 RLS가 적용되는 클라이언트 키다. 서비스 역할 키를 `NEXT_PUBLIC_`/`VITE_`에 넣지 않는다.
4. 마이그레이션과 Auth 설정 후 서버 `ACCOUNT_FEATURES_ENABLED=true`, 클라이언트 `NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED=true`를 함께 설정하고 다시 빌드한다. 켜진 서버는 인증/DB 오류를 무인증 생성으로 우회하지 않는다. 두 플래그가 false인 개발 모드는 기존 무인증 API를 유지하므로 공개 유료 서비스에 사용하지 않는다.
5. `maite-private` 버킷은 비공개다. 서비스 역할만 업로드하며 서버가 소유권/구매권을 검사한 후 5분짜리 URL을 발행한다. 클라이언트의 하트/원장 직접 쓰기와 거래 RPC 실행을 허용하지 않는다.

## 2. 모바일 미리보기와 Android 실행

```powershell
npm install
npm run mobile:dev
```

브라우저에서 `http://127.0.0.1:5173/ideal`을 연다. API 주소가 비어 있으면 개발 프록시가 `localhost:3000`의 `npm run dev` 서버로 전달한다. 웹 미리보기에서 Google 로그인을 테스트할 때 해당 `/ideal` 주소도 Supabase에 허용한다. 브라우저 미리보기에는 실제 인앱결제/광고/공유의 Android 동작이 포함되지 않는다.

실제 앱용으로 루트 `.env.local`에 `VITE_API_BASE_URL=https://실제-서버-주소`를 추가한다. 웹 전용 `NEXT_PUBLIC_API_BASE_URL`은 보통 비워둔다. 서버 `MOBILE_ALLOWED_ORIGINS`에는 `https://localhost`를 명시한다. 앱에 서버 주소가 없으면 생성 요청을 명확한 오류로 차단한다.

```powershell
npm run mobile:sync
npm run mobile:open
```

Android Studio에서 JDK 21 이상, Android SDK Platform 36 및 SDK 도구를 설정한 다음 에뮬레이터 또는 기기에서 실행한다. 현재 환경은 `JAVA_HOME`이 JDK 18이며 Android SDK 경로가 설정되지 않아 APK/AAB 컴파일 및 실행은 검증하지 못했다. 설치된 adb만으로 앱 빌드가 가능해지는 것은 아니다. 소스의 Gradle 프로젝트 생성과 웹 번들 복사는 완료했다. 앱 ID를 바꾸면 Capacitor 설정·Android namespace/applicationId·Manifest 로그인 scheme·Supabase 허용 주소·Play 설정을 함께 수정한다.

## 3. Google Play 결제

모든 상품은 **일회성 인앱 상품**이며 자동 갱신 구독을 생성하지 않는다.

| Play 상품 ID | 지급 | 콘솔 가격 |
|---|---|---|
| `hearts_100` | 100하트 | 2,000원 |
| `hearts_300` | 300하트 | 5,000원 |
| `hearts_700` | 700하트 | 10,000원 |
| `heart_pass_30` | 100 + 30일 일일 접속 보상 | 5,000원 |

Play Console 내부 테스트 트랙에 서명된 앱과 상품을 등록하고 라이선스 테스트 계정을 설정한다. 다중 수량 구매는 사용하지 않는다. 서비스 계정에 해당 앱의 구매 조회·소비 권한을 부여하고 서버의 `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PLAY_PRIVATE_KEY`를 설정한다. 콘솔 설정 후 테스트에만 `GOOGLE_PLAY_BILLING_ENABLED=true`를 켠다.

앱은 계정의 난독화 ID를 구매에 연결하고 서버가 Google 구매 상태·수량·계정·상품을 검증한다. 토큰 해시 중복 방지 후 지급하고 Google 소비 API로 구매를 완료한다. 앱에서 승인 대기 구매는 지급하지 않으며 ‘구매 복구’로 미완료 구매를 재검증한다. 상품의 실제 결제 금액은 Google 결제창에서 최종 확인한다.

**아직 공개 유료 운영 단계가 아니다.** 환불/취소/차지백 RTDN 또는 Voided Purchases 연동과 이미 사용·판매된 하트 회수 정책은 구현되지 않았다. 활성 기간권 중복 결제의 사전 방지 및 여러 기기 동시 결제 보상 정책도 출시 전 보완해야 한다. Google 실제 결제·복구 검증을 수행하지 않았다.

## 4. 보상 광고

AdMob Android 앱 및 보상형 광고 단위를 생성하고 보상을 5하트로 설정한다. SSV URL을 `https://서버/api/ads/ssv`로 등록한다. 서버의 `ADMOB_REWARDED_UNIT_ID`는 콜백의 `ad_unit` 값, 앱의 `NEXT_PUBLIC_ADMOB_REWARDED_ID`는 SDK가 받는 광고 단위 ID다. 서버 `ADMOB_REWARDS_ENABLED=true`는 연결 테스트 준비 후 켠다.

SDK의 사용자 동의 절차를 거쳐 광고를 표시하며 앱 완료 콜백으로 잔액을 올리지 않는다. 서버는 Google ECDSA 서명과 허용 단위·보상량·계정·타임스탬프를 검사하고 거래 ID 중복/일일 횟수를 DB에서 강제한다. 테스트 광고에서는 실제 SSV 보상이 발생하지 않을 수 있다. 이때 클라이언트 임의 보상으로 우회하지 않는다.

개발 기본값은 테스트 광고 모드와 Google 샘플 앱 ID다. 실제 빌드에는 Gradle `-PADMOB_APP_ID=실제앱ID`를 전달하고 `NEXT_PUBLIC_ADMOB_TESTING=false`로 바꾸며 재빌드한다. 실제 앱 ID·개인정보 동의·SSV 테스트가 끝나기 전 공개 광고를 켜지 않는다.

## 확인한 것과 남은 것

- 검증: `npm run typecheck`, 단위 테스트 65개(기존 59 + 계정/원장·서명·결제 검증/복원 6), 기존 웹 브라우저 26개, 모바일 브라우저 1개 및 `npm run build`, `npm run mobile:sync`. 저장 기록 보강 후 관련 웹 시나리오 6개도 재검증했다. SQL은 PostgreSQL 엔진(PGlite)에서 실행했고, Google/Supabase/OpenAI 통신 테스트는 모킹했다. 유료 라이브 호출은 사용하지 않았다. Android APK/AAB 실행 통과를 의미하지 않는다.
- 계정 삭제/탈퇴·환불 원장, 신고 관리자 처리/스토어 콘텐츠 심사, 재판매·파생 캐릭터 권리, 여러 기기 동시 문서 수정 충돌, 큰 보관함의 페이지 분할·검색·백업, 스토어 정산 운영 정책은 후속 작업이다. 현재는 문서 스냅샷 방식이며 메시지 단위 정규화 DB는 아니다. 보관함 스냅샷은 화면별 완료 메시지 최대 1,000개 및 요청 전체 500,000바이트로 제한하고, 초과 시 자동 저장 오류를 표시한다. 표시/저장용 기록과 API 전송용 최근 문맥은 분리해 저장 때문에 모델 입력을 늘리지 않는다.
- 개인 생성 완료 결과와 스토어 구매는 서버에 보존하지만 Google/Supabase 장애, 만료된 로그인, 앱 강제 종료/저장 용량 초과, 네이티브 결제·광고·키보드·뒤로가기 동작은 실제 기기로 통합 검증해야 한다.
- 푸시 알림/먼저 말 걸기와 예약 생성은 이번 범위에 추가하지 않았다. 캐릭터의 현재 기능 설명은 계속 선제 알림을 약속하지 않도록 유지한다.

공식 참고: [Capacitor App](https://capacitorjs.com/docs/apis/app), [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Google 구매 검증 API](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products), [AdMob SSV 서명 검증](https://developers.google.com/admob/android/ssv).
