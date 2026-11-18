# Android · 계정 · 하트 구현 및 설정

> 2026-11-19 최신: 사용자 프로필 나이 입력/표시·나이 비교 말투·콘텐츠 신고 버튼을 제거했다. 첫 말투는 AI가 캐릭터 성격과 컨셉으로 선택한다. 미완결 소설도 1회차부터 판매하며, 재등록 시 새 회차만 추가한다. 이 변경은 추가 SQL 없이 서버/앱 배포로 적용한다.

2026-11-18. 이 문서는 소스에 추가된 기능과 실제 운영 전 필요한 설정·검증을 구분한다. 기존 `.env.local`의 OpenAI 모델/키는 변경하지 않았다.

## 11월 18일 적용 사항

- 안부는 현재 테스트용 **3분** 대기로 설정되어 있다. 야간 22~10시와 하루 1회 제한은 유지한다. `lib/notifications/timing.ts`를 1440분으로 복구하면 운영 24시간 기준으로 돌아간다. 변경에는 서버 배포와 앱 재빌드가 함께 필요하다.

- 캐릭터 24시간 안부는 앱 자체 예약 알림으로 제공한다. 기본 앱 알림 꺼짐·야간 제한 켜짐이며 야간은 한국시간 22~10시다. Firebase와 서버 예약 실행은 필요 없다. 적용한 알림 DB를 재사용하며 추가 SQL 없이 새 서버 배포와 앱 재빌드로 반영한다. [설정 절차와 기기 동기화 한계](CHARACTER_CHECKINS.md)를 따른다.

- 신규 소설 삽화는 생성 요청 당시의 소설 ID와 회차 번호를 스냅샷에 저장한다. 소설 상세에서 해당 회차의 삽화를 옅은 배경으로 표시하며, 생성 중 회차를 바꾸어도 연결은 유지한다. 기존 삽화는 자동 추정하지 않는다. 추가 SQL·AI 호출은 없다.

- 생성 화면 유지: 앱 내부 메뉴를 이동해도 캐릭터·대화·소설·장면 생성을 취소하지 않는다. 명시적 취소와 캐릭터 교체·로그아웃 시에는 종료한다. OS가 앱을 강제 종료한 경우까지 보장하는 기능은 아니다. 소설은 팝업 대신 버튼 스피너로 진행을 표시한다.
- 이미지 캐시 확장: 메모리 24시간(64MB), 기기 Cache Storage 7일(64MB)을 사용한다. 계정별로 구분하며 로그아웃·계정 전환 시 지운다. 저장 기능 미지원 시 기존 네트워크 로딩을 사용한다. 서명 URL의 유효기간과 서버 소유권 검사는 유지한다.

- 프로필 사진: 최초 프로필 입력·프로필 수정에서 사진 선택과 삭제를 지원한다. JPG/PNG/WebP 최대 5MB를 서버에서 검증하고 512px JPEG로 축소해 비공개 저장한다. 마이페이지·상단 아바타에 표시한다. 기존 버킷을 사용하므로 추가 SQL은 없다. Android 적용에는 서버 배포 후 `npm run mobile:sync`와 앱 재빌드가 필요하다.

- 이미지 전송 개선: 비공개 서명 URL을 4분 재사용하고, 만료 시 권한 검사를 거쳐 갱신한다. 계정별 Blob 캐시(24MB·100개·1시간)는 계정 변경 시 비운다. 목록·갤러리·배경 선택은 256px WebP 썸네일을 사용하며 전체화면·실제 배경만 원본을 요청한다. 현재 Supabase 버킷에는 WebP 허용과 기존 이미지 21장 썸네일 추가를 완료했다. 다른 환경은 `supabase/migrations/202611180002_storage_thumbnails.sql`을 적용한다. 버킷을 공개로 변경하지 않는다. Android에는 `npm run mobile:sync`와 재빌드가 필요하다.

- 속도 개선: 문서·이미지 주소를 `media=1`로 함께 조회하고 같은 로그인 세션의 중복 GET을 공유한다. 원본 캐릭터를 먼저 열고 갤러리는 백그라운드에서 내려받는다. 아직 받지 않은 이미지의 목록도 서버 저장에 보존한다. 모바일에는 `npm run mobile:sync` 후 재빌드로 적용하며, 새 API가 없는 기존 서버에는 호환 조회로 동작한다.
- 서점 조회는 병렬 처리한다. API 응답 `Server-Timing`에서 `auth`, `document_db`, `images_db`, `storage_sign`, `store_db` 시간을 확인할 수 있다. 계정 잔액을 완료 캐시로 재사용하거나 소유권 검사를 생략하지 않는다. 추가 SQL 실행은 필요 없다.
- 로컬 기본 개발 명령은 Turbopack이다. 기존 Webpack 개발 서버는 `npm run dev:webpack`으로 실행할 수 있고 배포 빌드는 기존 Webpack을 유지한다.

- 현재 회차 삽화는 해당 장면에 실제 등장하는 인물만 그린다. 설명 정리의 `characterPresent=false`이면 원본 캐릭터 참조를 렌더러에 보내지 않는다. 추가 모델 호출은 없다. 사용자 호칭은 컨셉의 명시적 자기 지칭 > 로그인 닉네임 > 당신 순으로 생성하며 기존 원고는 재작성하지 않는다.
- 소설의 새 이야기·캐릭터 설정 아이콘을 제거하고 배경·갤러리 버튼과 프로필 수정·캐릭터 삭제를 앱 디자인으로 통일했다. 하트 작업 내역 팝업은 제거했으며 상단 하트를 누르면 충전 스토어로 이동한다. 서버의 작업 결과·원장은 유지한다.
- 자동 저장 중복과 저장마다의 계정 재조회를 제거하고 계정 응답에서 사용하지 않는 작업·기간권·원장 조회 3개를 제외했다. 문서·이미지 조회는 만료 정산을 기다리지 않는다. 닉네임·잔액과 소유권은 서버 확인을 유지한다. 이전의 작업 내역 팝업 안내보다 이 절이 우선한다.

- `supabase/migrations/202611180001_deferred_billing_and_character_delete.sql`을 기존 기본 마이그레이션 이후 실행한다. 현재 연결된 프로젝트에는 사용자가 실행했고 새 열과 RPC 존재를 확인했다. 별도 테스트·운영 DB에도 이 파일을 적용해야 한다.
- 생성 중에는 하트와 무료 대화의 사용 가능분만 예약하고 표시 잔액을 줄이지 않는다. 완성된 텍스트 또는 검증·업로드를 마친 이미지가 서버에 정상 저장될 때 한 번만 차감한다. 완료 확정 전 실패·취소는 예약만 해제하며, 완료 후 통신 단절은 저장된 작업 결과를 다시 연다. 과거 선차감 작업의 환불은 기존 규칙을 유지한다.
- 이미지 생성은 버튼의 스피너로 표시하며 읽기를 막는 팝업과 완료 후 자동 전체화면 표시를 제거했다. 기존 소설 회차는 이미지 생성 중에도 넘길 수 있다. 소설 생성 팝업의 사용량 버튼도 제거했다. 상단은 닉네임과 하트만 표시하며 화면 내부의 배경·갤러리 메뉴는 유지한다.
- 캐릭터 상세 하단에서 확인 후 삭제할 수 있다. 연결된 개인 대화·소설을 보관함에서 숨기고 판매를 중지한다. 기존 구매자의 공개 사본·주문·정산 원장·완료 작업은 보존하며 자동 저장으로 삭제한 문서가 복원되지 않게 차단한다.

## 구현한 흐름

- 기존 Next 웹 화면과 `apps/mobile`의 React/Vite 화면이 캐릭터·대화·소설·갤러리 컴포넌트를 공유한다. Capacitor 8 Android 프로젝트의 앱 ID는 `com.oestewdio.maite`이다. Next 서버와 OpenAI 키는 앱에 포함되지 않는다.
- 공통 `apiFetch`가 웹에서는 상대 경로, 앱에서는 설정된 HTTPS API를 사용하며 Supabase Bearer 토큰을 전송한다. `/api/chat`, `/api/characters`는 명시적 CORS와 스트리밍을 지원한다. 계정 모드에서 CAD 기술 검증 API는 사용을 차단한다.
- Google 로그인, 잔액/무료 대화, 출석 수령, 현재 작업 저장/불러오기, 작업별 완료 결과 재열람, 콘텐츠 신고 화면을 상단 **계정 · 하트** 메뉴에 추가했다.
- 생성 전에 하트/무료 대화의 사용 가능분을 예약하고, 완성된 응답·이미지를 서버에 저장할 때 차감한다. 완료 확정 전 실패·취소 시 예약만 해제하고, 응답 유실 시 계정 메뉴에서 결과를 다시 확인한다. 같은 `X-Request-Id`의 재전송은 AI를 다시 호출하지 않는다. 새 요청 ID로 명시적으로 재시도하면 새 작업이다.
- 서버가 강제 종료돼 남은 예약은 15분 이후 해당 계정 조회 시 반환한다. 생성 서버 최대 실행 시간은 5분 이하로 유지해야 한다. 이미지 업로드 후 DB 확정 실패 시 고아 파일 정리 작업은 운영에서 별도 관리가 필요하다.
- 개인 보관함은 `documents`의 버전 1 스냅샷에 프로필·완료 대화·소설 회차·기억·공통 시간선·현재 캐릭터 갤러리 참조를 저장한다. 실제 이미지와 생성 작업별 결과는 별도 비공개 Storage/DB에 저장된다. 완료 시 자동 저장하고 메뉴에서 수동 저장도 가능하다. 모바일은 Blob을 포함해 IndexedDB에도 보관한다. 웹의 미로그인 탭 기록은 기존처럼 새로고침 시 초기화한다.
- 모바일에서 백그라운드 전환 시 진행 생성을 중지한다. 완료된 내용만 저장하며 자동 재시도하지 않는다. 이미지/토큰 CSV는 네이티브 공유 메뉴로 저장할 수 있다. 뒤로가기는 열린 다이얼로그를 먼저 닫는다.
- 스토어 등록은 공개용 프로필/캐릭터 이미지 또는 선택한 소설 회차 스냅샷만 게시한다. 개인 대화·기억·시간선은 포함하지 않는다. 구매한 캐릭터를 사용할 때 판매자의 세션을 복사하지 않는다. 구매 소설은 재차 차감 없이 읽고, 판매 중지된 구매본도 권한으로 접근한다.

## 확정 정책과 구현 기본값

| 항목 | 적용값 |
|---|---|
| 가입 무료 대화 | 계정 최초 1회, 총 5회. 캐릭터 변경/앱 재설치로 재지급하지 않음 |
| 생성 | 캐릭터 50 / 유료 대화 2 / 소설 회차 20 / 삽화 50 / 대화 이미지 30하트 |
| 내부 검증 | 같은 작업 내 추가 모델 호출은 하트 추가 차감 없음. 실제 OpenAI 사용량은 별도 발생 |
| 출석 | 한국시간 당일 달력에서 직접 수령, 월~토 5 / 일요일 총 15하트. 지난 출석 보상은 소멸 |
| 광고 | 서명된 서버 콜백당 5하트, 계정당 하루 최대 5회 |
| 기간권 | 자동 갱신 없는 일회성 상품, 즉시 200 + 날짜별 20하트 × 30일, 최대 800하트. 지난 패스 보상 소급 수령 가능 |

2026-11-18 서고·보상 달력 업데이트는 005 다음에 `supabase/migrations/202611180006_library_rewards_story_cost.sql`을 적용한다. 소설 신규 예약 비용이 20하트로 바뀌고, 자동 출석/패스 지급 대신 마이페이지 → 출석보상 달력의 수동 지급으로 전환된다. 출석은 당일만, 패스는 구매 기간 중 지난 날짜도 나중에 받을 수 있다. 현재 패스 기간은 이관하며 이후 기간은 별도 보존한다. 적용 전 덮어쓴 과거 패스는 복원하지 않는다. 기존 잔액·지급 기록·진행 중 예약은 유지한다.
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

이 프로젝트의 Gradle 8.14.3에는 **JDK 21**을 사용한다. 최신 Android Studio에 포함된 Java 25를 그대로 사용하면 호환되지 않는다. Android SDK Platform 36 및 SDK Build Tools 36도 설치한다. 앱 ID를 바꾸면 Capacitor 설정·Android namespace/applicationId·Manifest 로그인 scheme·Supabase 허용 주소·Play 설정을 함께 수정한다.

2026-11-17 현재 PC 설정을 완료했다.

- Android Studio: `D:\Android\Android Studio` (2026.2.2)
- JDK: `%USERPROFILE%\.jdks\jdk-21.0.13+9` (Temurin 21)
- Android SDK: `D:\Android\AddData\Local\Android\Sdk`, Platform 36 / Build Tools 36.0.0
- `apps/mobile/android/local.properties`에 SDK 경로, `.gradle/config.properties`에 JDK 경로를 저장했다. Android Studio 프로젝트는 `#GRADLE_LOCAL_JAVA_HOME`을 사용한다. 로컬 경로 파일은 Git에서 제외한다.
- Android Studio에서 다른 JDK가 선택되어 있다면 **File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**에서 위 JDK 21을 선택한다.

Windows에서 다음 명령으로 실제 Android 빌드를 수행한다.

```powershell
npm run android:apk
npm run android:aab
```

두 명령은 모바일 웹 번들 생성·동기화 후 Gradle을 실행한다. APK는 `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 서명된 AAB는 `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`에 생성한다. APK 생성, AAB 생성 및 AAB 서명 검증이 통과했다. 기기/에뮬레이터 실행과 실제 Play 결제는 별도 검증해야 한다.

첫 Play 업로드용 서명키는 `%USERPROFILE%\.maite\signing\maite-upload.jks`, 비밀번호·별칭은 같은 폴더의 `maite-upload.json`, 공개 인증서는 `maite-upload-certificate.pem`에 저장했다. 이 폴더는 현재 사용자·시스템·관리자만 접근하도록 설정했고 Git과 APK/서버 소스 업로드에 포함하지 않는다. **키와 비밀번호 파일을 개인 보관소에 함께 백업해야 이후 업데이트에 같은 업로드 키를 사용할 수 있다.** Gradle에는 빌드 프로세스의 `MAITE_UPLOAD_*` 환경변수로만 전달한다. JSON 내용이나 비밀번호를 채팅에 보내지 않는다.

## 2-1. 연결한 테스트 서버

`https://maite-five.vercel.app`의 기존 `maite` 프로젝트에 최신 소스를 배포했다. 로컬 `VITE_API_BASE_URL`도 이 HTTPS 서버로 연결했다. 서버에는 OpenAI 모델/키, Supabase URL·공개 키·서비스 키, 계정 활성화 플래그와 Android Origin을 설정했다. 결제·광고는 필요한 외부 설정이 끝날 때까지 비활성이다.

배포 후 `/ideal` 200, 미로그인 `/api/account` 및 `/api/billing` 401, `https://localhost` Origin의 `/api/characters`·`/api/chat` OPTIONS 204를 확인했다. 로그인하지 않은 요청의 401은 정상이다. Supabase에는 웹 복귀 주소 `https://maite-five.vercel.app/ideal`과 앱 복귀 주소 `com.oestewdio.maite://auth/callback`을 허용한다.

Vercel 연결은 `.vercel/project.json`에만 저장하며 `.vercelignore`로 `.env*`, 서명키, `.verification`, Android 빌드 출력 등을 소스 업로드에서 제외한다. 이번 CLI 배포는 현재 작업 폴더를 사용했다. **GitHub에는 아직 반영하지 않은 변경이 있으므로, 이후 Git 기반 재배포 전에 최신 소스를 저장소에도 반영해야 한다.**

## 3. Google Play 결제

모든 상품은 **일회성 인앱 상품**이며 자동 갱신 구독을 생성하지 않는다.

| Play 상품 ID | 지급 | 콘솔 가격 |
|---|---|---|
| `hearts_100` | 150하트 | 2,000원 |
| `hearts_300` | 400하트 | 5,000원 |
| `hearts_700` | 1,000하트 | 10,000원 |
| `heart_pass_30` | 즉시 200 + 접속일마다 20 × 30일, 최대 800하트 | 5,000원 |

2026-11-18 일반 상품 변경은 `supabase/migrations/202611180004_heart_product_amounts.sql`, 패스 800하트 변경은 그 다음 `202611180005_heart_pass_800.sql`을 적용한다. 004를 이미 실행했다면 005만 실행한다. 기존 Play 상품 ID를 유지하므로 상품을 새로 만들 필요는 없다. Play Console의 상품 이름/설명도 150·400·1,000하트 및 패스 즉시 200 + 매일 20으로 수정한다. 기존 잔액·구매 재처리 지급량·기존 패스의 일일 10/15하트 조건은 유지한다. SQL 적용 확인 후 새 서버/앱 설정을 배포한다.

Play Console 내부 테스트 트랙에 서명된 앱과 상품을 등록하고 라이선스 테스트 계정을 설정한다. 다중 수량 구매는 사용하지 않는다. 서비스 계정에 해당 앱의 구매 조회·소비 권한을 부여하고 서버의 `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PLAY_PRIVATE_KEY`를 설정한다. 콘솔 설정 후 테스트에만 `GOOGLE_PLAY_BILLING_ENABLED=true`를 켠다.

현재 Play Console에서는 **Monetize with Play → Products → One-time products(일회성 제품)**에서 위 네 상품을 만든다. 각 상품에 구매 옵션을 하나 추가하고 구매 유형 **Buy**, 구매 옵션 ID `buy`, 대한민국 가격을 위 표대로 설정한 뒤 옵션을 활성화한다. 30일 기간권도 일회성 Buy 상품이며, 정기결제나 Rent 옵션을 만들지 않는다. 기간 만료와 일일 하트는 이 프로젝트 서버가 처리한다.

상품 메뉴에서 먼저 앱 번들 업로드를 요구하면 **테스트 및 출시 → 내부 테스트 → 새 버전 만들기**에서 서명된 AAB를 업로드한다. 패키지명은 `com.oestewdio.maite`다. 최초 업로드한 **versionCode 1**은 상품 ID `hearts_700`을 사용하므로 해당 상품을 Play에 새로 등록하면 AAB 재업로드 없이 사용할 수 있다. 이미 만든 `heart_700` 상품도 서버에서 호환 처리한다. 준비했던 versionCode 2 / versionName 1.0.1의 재업로드는 필수가 아니다. 이후 새 앱 버전 업로드에는 이전에 사용한 versionCode보다 큰 값을 사용한다. 생성된 APK에서 `com.android.vending.BILLING` 권한과 targetSdk 36을 확인했다.

### 구매 검증용 서비스 계정

이 계정은 Google 로그인 OAuth 클라이언트와 별개이며 서버에서 구매 영수증을 확인할 때 사용한다.

1. [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com)를 열고 MAITE용 Google Cloud 프로젝트를 선택해 API를 사용 설정한다.
2. [서비스 계정](https://console.cloud.google.com/iam-admin/serviceaccounts)에서 `maite-play-billing` 같은 이름으로 계정을 만든다. 이 용도에 Google Cloud 프로젝트 소유자 권한을 부여할 필요는 없다.
3. Play Console의 **사용자 및 권한 → 새 사용자 초대**에서 서비스 계정 이메일을 입력한다. MAITE 앱 접근 권한과 **재무 데이터·주문·취소 설문 응답 보기**, **주문 및 정기 결제 관리** 권한을 부여한다.
4. Google Cloud 서비스 계정의 **키 → 키 추가 → 새 키 만들기 → JSON**으로 키를 내려받는다. 프로젝트에 보관한다면 Git 제외 경로인 `.verification/google-play-service-account.json`을 사용한다. 파일 내용이나 개인키를 채팅에 보내지 않는다.
5. JSON의 `client_email`은 서버의 `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`, `private_key`는 `GOOGLE_PLAY_PRIVATE_KEY`로 연결한다. 공개 환경변수나 APK에 넣지 않는다. 구매 상품 및 API 접근 확인 후 `GOOGLE_PLAY_BILLING_ENABLED=true`로 바꾸고 Vercel에 재배포한다.

테스트 계정은 **내부 테스트 참여자**와 **라이선스 테스터** 양쪽에 등록한다. 테스트 참여 링크로 앱을 설치하고 결제창에서 Google 테스트 카드를 선택한다. 내부 테스트 참여자 등록만으로 모의 결제가 보장되는 것은 아니다. 현재 기간권은 서버에서 30일을 계산하므로 Google의 구독 가속 테스트 대상이 아니다.

2026-11-17 연결 확인: 서비스 계정 JSON을 로컬 `.verification/google-play-service-account.json`에 저장하고 파일 접근 권한을 현재 사용자·시스템·관리자로 제한했다. Google OAuth 토큰 발급과 기존 Play 상품 4개의 활성 상태·대한민국 가격 조회가 통과했다. 앱·DB의 공통 상품 ID는 `hearts_700`으로 유지한다. 기존 등록 상품 `heart_700`과 새로 등록할 `hearts_700` 모두 동일한 700하트 지급으로 처리하며, DB SQL 재적용은 필요 없다. 새 `hearts_700`의 Play 등록·활성 상태는 별도로 확인해야 한다.

Play API에서 서비스 계정의 `ACCESS_GRANTED`, MAITE 앱 접근, 재무 데이터 보기·주문 관리 권한을 확인했다. 다만 당시 재무·구매 검증 API가 `401 permissionDenied`를 반환해 **결제 활성화 플래그는 false로 유지**한다. Google은 권한 변경 반영에 최대 48시간이 걸릴 수 있다고 [안내](https://developers.google.com/android-publisher/api-ref/rest/v3/users#DeveloperLevelPermission)한다. 추가 권한 변경을 반복하지 말고 `node .verification/android-setup/check-play-access.mjs`로 재확인한다. 이 명령은 상품/재무 API를 조회할 뿐 실제 결제나 하트 지급을 실행하지 않는다. 실제 영수증 확인·소비는 라이선스 테스트 구매로 별도 검증한다.

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

추가 참고: [Gradle Java 호환성](https://docs.gradle.org/current/userguide/compatibility.html), [Play 일회성 제품 설정](https://support.google.com/googleplay/android-developer/answer/16430488), [서비스 계정의 Play 권한](https://developers.google.com/android-publisher/getting_started).
