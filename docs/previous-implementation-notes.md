# MAITE — Text to CAD

## 상단 메뉴: 모양 / 이상형

- **모양**(`/`): 기존 채팅 기반 3D CAD와 STEP 다운로드.
- **이상형**(`/ideal`): 키워드로 2D 애니메이션 캐릭터를 생성하고 JPG로 다운로드. 예: ‘동탄 유부녀 누님, 긴 웨이브 머리, 우아한 원피스와 다정한 미소’, ‘책을 읽는 학생 마법사’.
- 이미지는 **가로 9 : 세로 16 (864×1536)**으로 요청합니다. 모든 캐릭터를 성인으로 바꾸지 않고 설명에 맞는 나이와 외형을 반영합니다. 어린/나이가 모호한 캐릭터는 비성적인 일반 의상·비율·구도로 표현하며 미성년 성적 콘텐츠는 계속 차단합니다.
- 실사·반실사보다 선명한 선화, 단순화한 애니메이션 얼굴, 덩어리로 표현한 머리카락, 2~3단 셀 채색을 우선하도록 프롬프트를 강화했습니다. 실제 그림체 준수 정도는 생성 결과로 확인해야 합니다.
- 명확한 성인 여성은 글래머러스한 체형과 가슴선이 드러나는 의상을 반영하며, ‘가슴을 더 크게, 네크라인을 더 깊게’ 같은 수정도 지원하도록 프롬프트를 조정했습니다. 나이가 불분명하거나 어린 캐릭터에는 적용하지 않습니다. 의상으로 신체를 가리는 일반적인 캐릭터 일러스트 범위이며, 사용자가 수수한 의상·다른 체형을 요청하면 그 설명을 우선합니다.
- 생성 후 ‘머리를 은발로 바꿔줘’처럼 수정하면 직전 성공 이미지를 함께 전송해 수정합니다. 새 대화는 이미지 참조도 초기화합니다. 페이지 이동·새로고침 시 대화/결과는 초기화됩니다.
- 사용자가 제공한 `public/references/anime-style.png`를 첫 생성부터 그림체 참고로 전송합니다. 선화·채색·의상 디테일을 참고하며 샘플 인물이나 드래곤을 매번 복제하도록 지시하지 않습니다. 참고 샘플은 생성 결과와 구분해 표시합니다.

이미지 기능도 같은 서버의 `OPENAI_API_KEY`를 사용합니다. `.env.local`이나 Vercel에 다음 값을 선택적으로 지정할 수 있습니다. 미설정 시 아래 기본값을 사용합니다.

```env
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=low
```

`OPENAI_MODEL`은 설명을 정리하는 텍스트 모델이고 `OPENAI_IMAGE_MODEL`은 그림을 생성하는 이미지 모델입니다. 같은 모델명이 아닙니다. 계정의 이미지 모델 사용 권한/조직 인증이 필요할 수 있습니다. 실제 모델 사용 가능 여부는 OpenAI 계정에서 확인하세요.

`POST /api/characters`는 multipart로 대화와 선택적 직전 JPEG를 받아, 콘텐츠 검사·프롬프트 정리·이미지 편집 API를 호출합니다. 비용 우선 기본 출력은 gpt-image-2 / 864×1536 (9:16) / low / JPEG 85이며 최대 2.5MB입니다. `OPENAI_IMAGE_QUALITY`는 low/medium/high를 지원합니다. Vercel 응답 크기를 고려해 이미지를 binary로 반환하고 서버의 참고 파일은 배포 추적 설정에 포함했습니다. 외부 이미지 URL은 입력으로 받지 않습니다.

2026-11-14 공식 문서의 gpt-image-2 low 세로형 출력 비용 예시는 $0.005/장입니다. 총액에는 참고 이미지·이전 이미지 입력과 텍스트 프롬프트 정리 비용이 추가됩니다. 모델 간 실제 총비용 최저를 보장하는 설정은 아니며 실제 usage로 비교해야 합니다. gpt-image-2는 2027-02-10 종료 예정이므로 이전에 후속 모델로 교체해야 합니다. 더 저렴한 토큰 단가의 구형 mini도 있지만 2026-12-01 종료 예정이라 기본값으로 채택하지 않았습니다. [출력 비용 예시](https://developers.openai.com/api/docs/guides/image-generation), [종료 일정](https://developers.openai.com/api/docs/deprecations).

이상형 생성은 인스턴스 전체 분당 3회, 최대 13개 대화 메시지, 입력 요청 약 2.65MB, 서버 타임아웃 270초로 제한합니다. Vercel 함수 최대 시간을 300초로 지정했으며 배포 플랜에서 허용해야 합니다. 기존 3D 생성 제한과 별도입니다. 취소 시 화면과 요청을 정리하지만 이미 처리된 AI 호출 비용이 환불된다고 보장하지 않습니다.

캐릭터 API 테스트는 유료 API 경계만 고정해 실제 참고 이미지 첨부, 수정 이미지 전달, 크기/형식 검증, 정책 거절과 요청 제한을 검사합니다. 브라우저 테스트는 메뉴 이동·그림체 참고·다운로드·수정·취소·모바일 화면을 검사합니다. **이번 변경에서 실제 유료 이미지 생성과 외형 품질은 검증하지 않았습니다.** 샘플 이미지를 테스트 생성 결과로 보고하지 않습니다.

참고: [OpenAI 이미지 편집 API](https://developers.openai.com/api/reference/resources/images/methods/edit), [이미지 생성 가이드](https://developers.openai.com/api/docs/guides/image-generation).

## 현재 제품: 채팅 → OpenAI → 브라우저 CAD

루트 `/`는 채팅 기반 스튜디오입니다. 자연어 설명과 후속 수정을 OpenAI가 해석하고, 생성용 프롬프트를 정리한 다음 Structured Outputs로 형상 명세를 만듭니다. Worker가 동일 명세에서 미리보기와 STEP을 생성합니다. Meshy 등 추가 AI는 사용하지 않습니다.

### 설정

`.env.example`을 `.env.local`로 복사하고 `OPENAI_API_KEY`를 입력하세요. `OPENAI_MODEL` 기본값은 `gpt-4.1`입니다. 변경 후 개발 서버를 재시작하세요. 키는 브라우저에 전달되지 않습니다.

사업성 검토용 MVP이므로 **로그인·회원가입·서비스 접근 코드 없이** 접속 즉시 사용합니다. 개발·운영 모두 같습니다. `APP_ACCESS_TOKEN`과 `NEXT_PUBLIC_SUPABASE_*`는 현재 사용하지 않으며 기존 `.env.local`에 남아 있어도 필요 없습니다. 사용자 환경파일은 자동 수정하지 않습니다.

현재 서버 인스턴스 전체에서 분당 5회 요청을 허용합니다. 두 검토자가 이 한도를 공유합니다. 요청당 AI 호출 2회, 출력 토큰 1,400 + 10,000, 대화 24KB, 최대 40개 부품 제한을 유지합니다. 이는 인스턴스 내 제한이며 분산 환경의 전역 제한은 아닙니다.

### 지원과 검증 범위

- box / ellipsoid / cylinder / 삼각 기둥 roof, XYZ 회전·이동, 기존 부품 절삭. 단위 mm.
- 여러 솔리드의 조립체이며 단일 융합 솔리드나 즉시 3D 프린팅 가능한 결과를 보장하지 않습니다. 상세 얼굴·털·휘어진 전통 지붕·텍스처는 표현에 제한이 있습니다.
- 프롬프트와 JSON을 확인하고 JSON을 다운로드할 수 있습니다. CAD 실패 시 같은 명세로 재생성하거나 대화로 수정할 수 있습니다.
- 생성 취소는 fetch와 Worker를 중단합니다. 이미 서버에서 처리된 AI 요청의 비용이 취소되지는 않을 수 있습니다.
- 대화·결과는 현재 탭 메모리에서 유지됩니다. Supabase 저장은 아직 연결하지 않았습니다.
- 채팅 E2E는 유료 AI 응답 경계만 고정하며 실제 Worker/OCCT/STEP 생성·재읽기를 실행합니다. 실제 OpenAI 호출과 강아지·광화문 외형 품질은 별도 검증 대상입니다.
- 입력/명세 단위 테스트 7개, 브라우저 테스트 4개로 로그인 없는 화면·API 접근과 CAD 생성·취소·다운로드를 검증합니다. 채팅 테스트 형상은 독립 OCP 리더에서도 유효한 5개 솔리드로 확인했습니다. 이 형상은 실제 AI 생성 품질의 증거가 아닙니다.
- 기존 판재 화면과 검증은 `/technical/plate`로 이동했습니다.

아래는 기존 판재 PoC의 실행·기술 검증 기록입니다. ‘API 키 불필요’, ‘자연어 AI 미구현’ 등은 판재 검증 화면에 한정되며 현재 채팅 서비스에는 해당하지 않습니다.

`text-to-cad-plan.md`의 **Phase 0 우선 검증** 지시에 따라 실제 STEP 생성·다운로드를 먼저 구현한 한국어 CAD 워크스페이스입니다.

## 실행

Node.js 22.18+ 또는 24 LTS 권장. 최초 설치에는 인터넷 연결이 필요합니다.

```sh
npm ci
npm run dev
```

http://localhost:3000 에서 실행됩니다. API 키나 Supabase 계정 없이 사용할 수 있습니다.

```sh
npm run build
npm start
```

Vercel에서는 Next.js 프레임워크, `npm ci`, `npm run build`, 기본 출력 디렉터리를 사용합니다. `postinstall`이 엔진을 `public/wasm/`에 복사합니다. 해당 디렉터리는 Git에서 제외하며, install scripts를 끈 경우 `npm run prepare:cad`를 실행하세요. 실제 Vercel 배포는 아직 하지 않았습니다.

## 구현 범위

- Next.js App Router + TypeScript + Tailwind CSS 반응형 워크스페이스
- 판재 가로·세로·두께, 구멍 지름·간격 편집 및 프리셋 3개
- Web Worker의 OpenCascade.js WASM에서 실제 B-Rep 및 Boolean cut
- 실제 테셀레이션의 Three.js 미리보기, 회전·확대·이동, 투시·평면·정면, 그리드·와이어프레임
- 진행 상태, 오류 안내, 120초 타임아웃, 즉시 취소·재생성
- 실제 STEP AP214 및 CAD JSON 다운로드
- 내보낸 STEP 재읽기, B-Rep 유효성·단일 솔리드·치수·체적 확인 후 다운로드 허용
- 최근 8개 작업의 **치수만** localStorage에 저장, 불러와 재생성
- 모바일 레이아웃, 키보드 포커스와 모달 Escape/포커스 제한

**미구현:** 자연어 AI, Supabase 로그인·DB·파일 저장, 캐릭터 생성. 기획서의 순서에 따라 후속 단계로 남겼고 UI에도 준비 중으로 표시합니다. 로컬 이력은 클라우드에 동기화되지 않으며 STEP 바이너리는 새로고침 후 복구되지 않습니다.

## CAD 엔진과 좌표

`replicad@1.2.1` + `replicad-opencascadejs@1.2.1` 고정. 후자는 **OpenCascade.js의 RepliCAD용 커스텀 WASM 배포판**입니다. 별도 CAD 서버나 Docker 빌드는 사용하지 않습니다.

설치된 타입·소스에서 `makeBox`, `makeCylinder`, `cut`, `mesh`, `exportSTEP`, `importSTEP`, `measureVolume`, OCCT `STEPCAFControl_Writer`, `BRepCheck_Analyzer`, `TopExp_Explorer` 지원을 확인했습니다. `exportSTEP`은 실제 OCCT STEP writer를 사용합니다.

Emscripten 로더는 Worker 안에서 동일 출처 `/wasm/replicad_single.js`로 동적 로딩하여 Node 전용 코드를 브라우저 번들에서 제외합니다. 첫 실행에 약 23 MB WASM을 받습니다. 단일 스레드 빌드라 SharedArrayBuffer/COOP/COEP는 요구하지 않습니다.

- mm, 오른손 좌표계, Z-up, 판재 중심 원점
- 판재 X/Y 20–300 mm, Z 1–30 mm
- 구멍 지름 1–40 mm, 모서리 간격 2–100 mm
- 구멍 중심 `±(width/2 - edgeOffset), ±(height/2 - edgeOffset)`
- 절삭 원통은 판재 아래 1 mm부터 위 1 mm까지 연장해 Z축 관통
- 구멍이 외곽·서로 겹치지 않도록 폼과 Worker 양쪽에서 Zod 검증
- 판재+선택적 구멍 4개로 제한. 임의 코드·AI 코드 실행은 없음

참고: [통합 가이드](https://replicad.pages.dev/docs/use-as-a-library/), [RepliCAD 소스](https://github.com/sgenoud/replicad), [OpenCascade.js](https://ocjs.org/).

## 검증

2026-11-14, Windows / Node.js 24 / Chromium 기준.

| 항목 | 결과 |
| --- | --- |
| TypeScript / 프로덕션 빌드 | 통과 |
| 입력 검증 단위 테스트 | 4개 통과 |
| 브라우저 E2E | Worker 생성·다운로드·취소·재생성, 입력 오류, 프리셋, 도움말, 모바일 가로 넘침 검사 |
| 실제 STEP | ISO-10303-21, MANIFOLD_SOLID_BREP, 원통면 4개 |
| 독립 CAD 리더 | CadQuery OCP / OCCT 7.9.3으로 재읽기 통과 |
| 유효성 / 솔리드 | 유효한 B-Rep / 단일 솔리드 |
| 치수 | 100 × 60 × 5 mm |
| 체적 | 29,434.51332235383 mm³ (`30000 - 4π·3²·5`) |
| 구멍 | 중심 (±40, ±20) mm / 지름 6 mm / 4개 |
| FreeCAD GUI | **미실행** — 이 환경에 미설치 |
| 다른 브라우저 / 실기기 모바일 / Vercel 배포 | 미검증 |

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

E2E는 포트 3100과 `.next-test`에서 별도 개발 서버를 자동 실행·종료하며 실제 AI 키와 Supabase 설정을 비워 외부 호출을 방지합니다. 포트는 `PLAYWRIGHT_PORT`로 변경할 수 있습니다. Next.js가 생성하는 타입 파일은 공유하므로 build와 E2E는 **순차 실행**하세요. STEP과 스크린샷은 Git에서 제외한 `.verification/`에 생성됩니다.

독립 CAD 검증은 선택적인 로컬 테스트이며 제품의 Python 서버나 런타임 의존성이 아닙니다.

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install cadquery-ocp-novtk==7.9.3.1.1
./.venv/Scripts/python.exe scripts/verify-step.py .verification/mounting-plate.step
```

### FreeCAD 수동 검증 게이트

1. 기본 마운팅 플레이트를 생성해 STEP을 다운로드합니다.
2. FreeCAD에서 열고 판재 100×60×5 mm, 구멍 지름 6 mm, 모서리 간격 10 mm를 측정합니다.
3. Part 작업대의 Check geometry(BOPCheck 포함)에서 유효성·솔리드 1개·체적 약 29,434.5133 mm³를 확인합니다.
4. 결과와 FreeCAD 버전을 기록합니다. 독립 리더 검증은 통과했지만 **FreeCAD GUI 검증까지 완료했다고 간주하지 않습니다.**

## 다음 작업

`agent.md`에 Codex 중요 작업과 원칙을 명시했습니다. `AGENTS.md`도 해당 파일을 참조해 자동 발견을 지원합니다.

1. FreeCAD GUI와 브라우저별 WASM 검증
2. OpenAI 서버 Route Handler + Structured Outputs + Zod CAD DSL (인증·사용량·비용 제한 포함)
3. Supabase Auth, DB 마이그레이션, 사용자별 RLS, private Storage, signed URL·소유권 검증
4. 저장된 작업 재시작, 단순 캐릭터 별도 스키마·출력 검증
5. Vercel 배포 및 실제 환경 회귀 테스트

브라우저 탭 종료 시 진행 중인 작업은 중단됩니다. 최신 데스크톱 Chrome/Edge를 권장하며 모바일·저사양 기기에서는 로딩과 메모리 비용이 늘어날 수 있습니다.

의존성 라이선스와 원본은 `THIRD_PARTY_NOTICES.md`를 참조하세요. 엔진은 별도 교체 가능한 JS/WASM 파일로 제공합니다.
