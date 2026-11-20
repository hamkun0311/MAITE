# 소설 검수 서버 로그

`NOVEL_REVIEW_LOG_LEVEL`로 `novel-review-trace` 서버 로그 범위를 설정한다. UI·SSE 이벤트·모델 입력·검수 지침·API 호출 수는 바꾸지 않는다. AI가 API로 반환한 원고/판정과 코드의 채택 결과를 기록하며 내부 추론 과정은 기록할 수 없다.

```env
# 로컬에서 초안과 보정 원고를 비교할 때
NOVEL_REVIEW_LOG_LEVEL=full
# 운영 권장값 (미설정 기본값)
# NOVEL_REVIEW_LOG_LEVEL=summary
# 진단 끄기
# NOVEL_REVIEW_LOG_LEVEL=off
```

로컬 `.env.local`은 full로 설정했다. 환경변수 변경 후 서버를 재시작하면 확실히 적용된다. 운영 환경변수는 별도 설정하며 이 작업에서 배포하지 않는다. 유효하지 않은 값/빈 문자열은 off로 처리한다. off는 새 검수 진단 로그를 끄며 기존 숫자 기반 ai-usage와 최소 운영 오류 로그까지 없애지는 않는다.

## 확인 위치와 연결

로컬은 `npm run dev` 터미널, 배포 후에는 Vercel의 서버 Runtime Logs에서 `novel-review-trace`와 `traceId`로 찾는다. 계정 기능을 사용하는 요청은 X-Request-Id(작업 ID)를 공통 traceId로 쓰며 응답의 X-Job-Id와 같다. 직접 생성 함수 호출/데모에서 유효한 ID가 없으면 서버가 UUID를 생성한다. 로그에는 API 키·인증 헤더·사용자 이메일을 넣지 않는다.

각 호출의 model_call_finished에는 기존 ai-usage의 id/responseId·모델·추론 강도·실제 사용 토큰·캐시/추론 토큰·소요 시간이 들어간다. 토큰을 반환하지 않은 경우 null/unknown을 그대로 기록하고 추정값을 만들지 않는다.

| 이벤트 | 의미 |
| --- | --- |
| started / model_call_started / model_call_finished | 요청 시작, 단계별 모델 호출 설정 및 사용량 |
| model_output | 원 API 출력 수신 (내용은 full에서만 기록) |
| draft | 표시용 정리를 거친 초안 또는 재작성 원고와 해시 |
| review | AI가 반환한 판정·sceneAudit·문제 문장·수정 지시·설정 준수·최종 결말 판정 |
| review_decision | 코드가 계산한 실제 accepted, 출처가 확인된 문제, 복사/진전/결말/설정/장면 검사 결과와 재시도 사유 |
| rewrite_requested | 재작성 요청 사유. full에는 실제 전달한 corrections도 포함 |
| integrated_draft / integrated_rejected | 통합 모드의 원고/자체 검수 또는 코드 검증 실패. 독립 검수와 구분 |
| completed | 채택한 최종 원고의 해시와 source(initial/rewrite), attempt, 전체 시간/호출 수 |
| failed | 생성/검수 실패 단계, 제한된 오류 사유. 검증 오류는 필드 경로/코드만 기록 |
| generation_persisted / generation_persistence_failed | generation_jobs 결과 저장 성공/실패. 성공 로그는 DB 완료 응답 뒤에만 출력 |
| document_saved | 후속 자동 저장으로 documents의 소설 스냅샷 저장까지 완료. story.lastJobId로 같은 traceId에 연결 |

`completed`는 생성·검수 완료이며 DB 저장 완료를 뜻하지 않는다. 계정 모드에서 generation_persisted와 document_saved를 따로 확인한다. 데모는 서버 저장을 하지 않아 이 두 로그가 없으며, 문서 저장 재시도/갱신으로 같은 작업의 document_saved가 반복될 수 있다. proseHash가 같으면 내용이 같은 원고다. 저장 로그는 현재 회차의 previousProse를 해시하며 과거 회차를 조회하거나 원고를 변경하지 않는다.

## 기록 범위

- summary: 판정, 문제 구절/수정안, 코드 판정, 원고 해시/길이, 호출/사용량 정보. 전체 원고·기억 요약·전체 패치는 제외한다. 문제 구절 자체에는 인물명 등 사용자 콘텐츠가 포함될 수 있다.
- full: summary와 함께 모델 원 출력, 초안, 검수 전체 결과, 재작성 지시, 최종 원고를 기록한다. 원고와 설정에서 유래한 민감한 내용이 포함될 수 있으므로 진단용으로 제한해서 사용한다.
- 긴 full 내용은 event=content로 600 유니코드 문자씩 나눈다. 같은 contentId의 part 순서대로 text를 합치면 원문이다. sourceEvent/name/attempt로 어느 단계의 출력인지 구별한다. 항목당 최대 100,000자를 기록하고 초과 시 truncated=true로 명시한다. UTF-16 중간이나 이모지를 끊지 않는다.
- 로그 출력 실패는 생성/검수/과금 결과를 바꾸지 않는다. 인증·저장 성공 조건·하트 후차감은 유지한다. 원문을 브라우저 콘솔이나 화면으로 전송하지 않는다.

고정 응답 테스트로 off/summary/full, 원고 조각 복원, 키/헤더 미기록, 재작성 전후 추적, 실제 저장 성공/실패 구분, 통합 모드에서 AI 통과와 코드 거부의 차이를 확인한다. 실제 유료 AI 호출이나 운영 DB 조회는 하지 않는다. 로그 추가는 AI의 의미 오류 탐지율을 높이는 변경이 아니며, 다음 실제 생성에서 검수가 놓친 부분과 보정이 만든 문제를 구별하기 위한 진단 수단이다.

검증: 타입 검사·단위 테스트180개·웹 회귀39개·Next.js 배포 빌드 통과. 모의 요청의 reviewed 재작성4호출과 integrated 보정2호출을 유지하고, 요금 정산 실패 시 저장 성공 로그가 생기지 않음을 확인했다.

## 회차 분량과 공유 약속

- `chapter_scene_budget`은 Gemini 집필의 도입 600자, 핵심 사건 1,300자, 선택과 결과 800자 목표를 기록한다. 실제 글자 수는 `draft`와 `completed`에서 확인한다. 짧은 원고도 내용 검수 대상이다.
- `chat_promise_update`는 대화 뒤 공유 시간선의 리비전, 약속 개수와 키를 기록한다. 메모리 갱신이 제한된 경우 `degraded`로 이유를 확인할 수 있다.
- `promise_context`는 소설에 전달할 시간선 리비전과 약속 목록의 식별 정보를 기록한다. `promise_audit`는 같은 소설 trace의 약속 순서별 이행(fulfilled), 변경(changed), 대기(pending), 누락(missed), 근거 부족(unsupported) 판정과 근거 존재 여부를 보여준다. 회차 최종 채택은 `completed` 또는 `review_decision`에서 확인한다.
- `full` 모드에서 약속 문구와 검수 근거 문장이 별도 content 조각에 기록된다. 약속의 이행 여부는 검수 모델의 판정과 현 원고의 인용 근거를 사용한다.
