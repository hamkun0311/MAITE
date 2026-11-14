# MAITE — 모양 / 이상형

로그인 없이 채팅으로 3D CAD와 2D 애니메이션 캐릭터를 만드는 사업성 검토용 MVP입니다. Next.js/Vercel에서 실행하며 별도 CAD/GPU 서버는 운영하지 않습니다.

## 실행

Node.js 22.18+ 또는 24 LTS를 사용합니다. `npm ci` 후 `.env.example`을 `.env.local`로 복사해 서버 환경변수를 설정하고 `npm run dev`를 실행합니다.

```env
OPENAI_API_KEY=OpenAI_서버_키
OPENAI_MODEL=gpt-6.1-sol
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
OPENAI_IMAGE_QUALITY=low
```

Vercel에도 같은 환경변수를 등록하고 재배포합니다. 키는 서버 전용이며 `NEXT_PUBLIC_*`에 넣지 않습니다. Cloudflare 설정, 접근 코드, Supabase 설정은 필요 없습니다. Supabase는 향후 저장 기능이 필요할 때 연결합니다. 대화와 결과는 현재 탭 메모리에 유지되며 새로고침·메뉴 이동 시 초기화됩니다.

## 모양 — `/`

채팅 → OpenAI 프롬프트 정리 및 제한된 CAD 명세 → 브라우저 Worker의 OpenCascade.js → Three.js 미리보기 → STEP/JSON 다운로드.

- box / ellipsoid / cylinder / roof, 이동·회전·절삭, 최대 40개 부품을 지원합니다.
- 브라우저에서 실제 B-Rep을 만들고 STEP을 다시 읽어 유효성·치수를 검사합니다.
- STEP은 여러 솔리드의 조립체일 수 있습니다. 실사 피규어, 정밀 복제, 단일 융합 솔리드·즉시 출력 가능한 형상을 보장하지 않습니다.
- `/technical/plate`는 기존 판재 검증 화면입니다. 과거 구현 기록은 `docs/previous-implementation-notes.md`에 있습니다.
- WASM 약 23MB는 `postinstall`에서 준비합니다. 필요하면 `npm run prepare:cad`를 실행합니다.

## 이상형 — `/ideal`

채팅 → OpenAI 콘텐츠 검사 및 캐릭터 설명 정리 → **GPT Image 2.5 Sunburst** → **세로형 9:16, 720×1280 JPG 다운로드**.

남녀 캐릭터의 톤앤매너를 `lib/characters/schema.ts`의 `CHARACTER_STYLES.female` / `CHARACTER_STYLES.male`에 각각 저장합니다. OpenAI가 대화의 요청 대상에 맞게 `styleProfile`을 선택하며 최신 성별 변경 요청을 우선합니다. 일반 수정은 이전 프로필을 이어갑니다. 성별 미지정·비인간 대상은 공통 스타일, 남녀가 함께 등장하면 혼합 스타일을 사용합니다. 머리 길이나 옷차림만으로 성별을 단정하지 않습니다.

- **여자 스타일:** 기존 모험가 샘플의 선명한 윤곽선, 풍부하고 따뜻한 채색, 셀 그림자와 부드러운 하이라이트, 장식의 정교한 마감을 참고합니다.
- **남자 스타일:** 새 첨부 샘플을 분석한 가늘고 섬세한 선화, 정제된 각진 얼굴 묘사, 저채도 회색·보랏빛 명암, 부드러운 셀 채색과 절제된 광택, 차분한 분위기를 참고합니다. 검은 머리·보라색 눈·귀걸이·초커·손짓을 자동으로 복제하지 않습니다.

‘그림체 참고’에서 여자/남자 스타일 설명을 전환할 수 있습니다. 이 선택은 참고 열람용이며 실제 생성 스타일은 채팅 내용에 따라 정합니다. ‘생성 프롬프트’는 생성 전 두 프로필, 생성 후 실제 선택된 스타일과 전달 문장을 보여줍니다.

인물·나이·성별·체형·의상·색상·표정·포즈·동반 생물·배경은 채팅 내용에 따라 정합니다. 샘플의 모험가·드래곤·의상을 자동으로 복제하지 않으며, 여성의 글래머러스함이나 남성의 섹시함도 자동 추가하지 않습니다. 2D 애니메이션 표현을 유지하고 모든 인물을 성인으로 고정하지 않습니다. 어린 캐릭터는 나이에 맞는 비성적인 디자인으로 표현합니다.

공통 스타일과 프롬프트 조립은 `lib/characters/schema.ts`에 있습니다. 대화로부터 최대 800자의 ASCII 영문 subject를 정리해 스타일 지시와 결합합니다. ‘생성 프롬프트’ 탭에서 실제 이미지 API에 보낸 문장을 확인할 수 있습니다.

- 여자 스타일은 기존 샘플 PNG를 그림체 참고로 전달합니다. 남자·공통·혼합 스타일에는 여자 샘플 파일을 보내지 않습니다. 남자 스타일은 첨부 이미지를 분석한 저장 프롬프트로 적용합니다. 참고 파일이나 이전 결과가 없으면 Images generations, 있으면 Images edits를 사용합니다. 수정 시 직전 결과를 입력해 정체성과 변경하지 않은 디테일의 유지를 요청하며 완벽한 동일인 유지를 보장하지는 않습니다.
- API에 720×1280 생성 크기를 요청하고 세로형 9:16 구도를 지시합니다. sharp로 최종 720×1280 JPEG를 보장하며, 다른 비율의 응답에는 여백을 넣어 피사체를 자르지 않습니다. GPT Image에는 FLUX의 ‘4단계’ 옵션이 없습니다.
- 품질은 기존 저비용 선호에 따라 `low`가 기본이며 `OPENAI_IMAGE_QUALITY`로 변경할 수 있습니다. 프롬프트 정리와 이미지 생성에는 OpenAI 요금이 적용됩니다.
- multipart 요청 최대 약 2.65MB, 직전 JPEG 최대 2.5MB, 최대 13개 메시지, 인스턴스 전체 분당 3회로 제한합니다. 이는 분산 환경의 전역 비용 제한이 아닙니다.
- 결과는 binary JPEG로 반환합니다. 실패/취소 시 새 결과 다운로드를 비활성화하고, 취소한 입력은 복원합니다. 새 대화는 이전 이미지 참조까지 삭제합니다.
- 서버 요청은 최대 270초, Vercel 함수 설정은 300초이며 배포 플랜에서 허용해야 합니다. 참고 PNG를 함수에 포함하도록 파일 추적을 설정했습니다.

## AI 실시간 대화

이상형 화면의 이미지 생성 채팅 아래에 별도 AI 대화 영역이 있습니다. `gpt-5.4-mini`의 Responses API 스트리밍을 사용해 답변이 도착하는 대로 표시합니다. 이미지 생성 대화와 기록을 따로 관리하므로 AI 대화로 이미지가 자동 생성·수정되지는 않습니다.

- 기존 `OPENAI_API_KEY`만 사용하며 별도 키나 모델 설정은 필요 없습니다. 이미지 생성 모델 설정과 독립적입니다. 대화에는 OpenAI 사용 요금이 적용됩니다.
- Enter로 보내기, Shift+Enter 줄바꿈, 응답 중지, AI 대화 초기화를 지원합니다. 완료된 대화를 다음 요청의 문맥에 반영하며 중단된 답변은 문맥에서 제외합니다.
- `/api/chat`은 `stream:true`, `store:false`로 호출합니다. 서버가 SSE를 해석해 답변 텍스트·완료·오류만 브라우저에 전달하고, 연결 종료 시 외부 생성 요청도 취소합니다. 키나 외부 오류 세부정보는 노출하지 않습니다.
- 최근 최대 21개 메시지, 총 24,000자, 요청 100KB, 출력 최대 2,000토큰, 서버 타임아웃 150초, 인스턴스별 분당 15회로 제한합니다. 대화는 현재 탭 메모리에만 유지됩니다.
- [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [OpenAI 스트리밍 문서](https://developers.openai.com/api/docs/guides/streaming-responses).

## 검증

변경 후 다음 명령을 순서대로 실행합니다.

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

E2E는 Chromium이 필요합니다(`npx playwright install chromium`). 포트 3100과 `.next-test`를 사용하며 `PLAYWRIGHT_PORT`로 변경할 수 있습니다. Next.js 생성 타입 파일을 공유하므로 build와 동시에 실행하지 않습니다.

- API 테스트는 외부 응답만 고정해 모델·생성 크기·품질·참고 이미지 순서, 이전 결과 전달, 입력 제한·콘텐츠 차단·요청 제한 및 실제 sharp 변환 결과의 720×1280 JPEG를 검증합니다.
- 브라우저 테스트는 메뉴·그림체 참고·실제 프롬프트 표시·생성·수정·다운로드·취소·모바일과 기존 CAD Worker/STEP 흐름을 검증합니다.
- AI 대화 테스트는 UTF-8/청크 경계 처리, 완료 전 텍스트 전달, 문맥 유지, 입력 제한, 외부 요청 취소, 중지·실패 후 재시도 및 이미지 생성과의 분리를 검증합니다. API 응답은 고정하며 실제 유료 모델 응답 품질·지연 시간은 별도 확인 대상입니다.
- 실제 유료 이미지 생성, 최종 그림체·프롬프트 반영 품질, Vercel 배포, FreeCAD GUI 수동 검증은 별도 확인 대상입니다. 고정 응답 테스트를 실제 생성 품질의 증거로 기록하지 않습니다.

참고: [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [Images edits API](https://developers.openai.com/api/reference/resources/images/methods/edit). 의존성 고지는 `THIRD_PARTY_NOTICES.md`, Codex 중요 작업은 `agent.md`를 참고하세요.
