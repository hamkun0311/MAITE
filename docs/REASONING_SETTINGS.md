# 동작별 추론 설정

서버의 `.env.local`에서 각 텍스트 생성 단계에 `low`, `medium`, `high`를 설정한다. 변경 후 개발 서버를 재시작한다. 운영 서버는 환경변수 설정 후 재배포해야 한다.

```dotenv
OPENAI_REASONING_EFFORT=medium
OPENAI_CHAT_REASONING_EFFORT=low
OPENAI_NOVEL_PLAN_REASONING_EFFORT=medium
OPENAI_NOVEL_WRITE_REASONING_EFFORT=low
OPENAI_NOVEL_REVIEW_REASONING_EFFORT=low
OPENAI_IMAGE_DESCRIPTION_REASONING_EFFORT=low
```

대화 설정은 대화 응답과 별도로 호출되는 경우의 말투·의상 판별에 적용된다. 현재 대화의 응답 안에서 수행하는 성격·기억 추출에는 동일한 대화 추론 설정이 적용된다. 원고 집필 설정은 최초 원고와 재작성에 모두 적용된다. 선택형 `integrated` 모드에서는 집필·자체 검수·기억이 하나의 호출이므로 집필 설정을 공유한다. 기본 `reviewed` 모드는 독립 검수 설정을 사용한다.

대화 설정이 없거나 유효하지 않으면 공통 설정을 사용한다. 기획·집필 설정은 기존 `OPENAI_NOVEL_REASONING_EFFORT`를 먼저, 이후 공통 설정을 사용한다. 집필만 low로 바꿔도 기획 설정에는 영향을 주지 않는다. 검수와 이미지 설명은 기존대로 미설정 시 low다. 추론을 지원하지 않는 모델에는 reasoning 필드를 보내지 않는다.

이미지 자체의 품질 설정 `OPENAI_IMAGE_QUALITY=medium`은 별도이며 이번 변경에서 유지했다. 모델, 출력 한도, 회차 생성 방식과 검수·기억 검증 기준도 유지했다. low의 실제 품질·속도 효과는 사용자가 생성 결과와 기존 토큰 사용량 메뉴로 비교한다. 자동 검사는 요청 설정과 기존 생성 흐름을 확인하며 실제 유료 생성 품질을 입증하지 않는다.
