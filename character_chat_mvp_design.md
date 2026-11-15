# AI 캐릭터 챗 MVP 개선 설계서

> **목표:** GPT-5.4-mini 기반의 일상 대화형 AI 캐릭터가 사용자·AI·제3자를 혼동하지 않고, 대화 문맥을 유지하며, 캐릭터 자신의 성격과 관점에 따라 자연스럽게 반응하도록 개선한다.
>
> **전제:** 기존 웹서비스, OpenAI API 사용, 별도 DB 없는 MVP, TypeScript/Node.js 예시. 프레임워크가 다르면 예시 코드를 맞춰 변경한다.

## 1. 문제 정의와 기대 동작

### 관찰된 문제

- **인물 혼동:** “나”, “너”, “걔”가 가리키는 대상을 잘못 해석함.
- **사건 혼동:** 누가 늦는지, 누가 누구에게 연락했는지 등 주어·목적어를 잊음.
- **과도한 동조:** 사용자가 제안하면 맥락과 무관하게 “좋아”, “그래”라고 응답함.
- **기억 단절:** 직전 발화만 처리하거나, 최근 대화를 보내더라도 중요한 사실을 추적하지 못함.
- **행동 혼동:** 가상 대화 속에서 한 행동과 실제 외부 서비스에서 수행한 행동을 구분하지 못함.

### 기대하는 대화

**상황:** 사용자와 AI 캐릭터 ‘유나’가 친구 ‘민수’를 만나기로 했다.

```text
사용자: 민수한테 나 오늘 좀 늦는다고 얘기해.
유나: 알았어. [가상 상황에서] 민수한테 네가 늦는다고 전해뒀어.
사용자: 그럼 오늘은 나랑 둘이서 놀 수 있겠네?
유나: 잠깐, 늦는 건 너잖아? 민수는 아직 오는 거고. ㅋㅋ 무슨 계획이야?
```

이 예시에서 **늦는 사람은 사용자**이며, “둘이서 놀 수 있다”는 결론은 자동으로 성립하지 않는다. AI는 사용자 말에 무조건 동의하는 대신 기존 사실과 캐릭터 성격을 바탕으로 응답해야 한다.

> 실제 메시지 전송 기능이 연결되지 않았다면 현실에서 전송을 완료했다고 말해서는 안 된다. 위의 ‘전해뒀어’는 **명시적으로 설정된 가상 대화 세계 안에서의 행동**이다. 서비스가 현실 대화 모드라면 “내가 직접 보낼 수는 없지만 이렇게 말해봐”처럼 답해야 한다.

## 2. MVP 권장 구조

```text
[사용자 메시지]
      |
      v
[Context Builder]
  ├─ Character Profile: 캐릭터 성격/말투/가치관/목표
  ├─ Participant Registry: user / AI / 제3자 ID
  ├─ Scene State: 현재 상황/장소/사건
  ├─ Confirmed Facts: 근거 있는 사실
  └─ Recent History: 최근 10~20턴(= 20~40개 메시지) 또는 토큰 예산 내 기록
      |
      v
[GPT-5.4-mini: 대사 + 상태 변경 제안]
      |
      v
[Validator: 스키마/인물 ID/근거/충돌 검사]
      |
      v
[응답 반환 + 세션 파일 저장]
```

**설계 원칙**

1. **정체성 고정:** 사용자, AI, 제3자는 고유 ID를 갖는다. 같은 이름을 가진 사람이 있어도 ID로 구분한다.
2. **기억은 애플리케이션이 관리:** 모델의 암묵적 기억에 의존하지 않는다.
3. **사실과 추측 분리:** 사용자가 말한 사실, 캐릭터의 가상 행동, 추측을 서로 다른 유형으로 보관한다.
4. **성격 기반 자율성:** 반대를 위한 반대나 무작위 감정 선택이 아니라 캐릭터의 목표와 관계를 반영한다.
5. **한 번의 모델 호출로 시작:** 초기에는 대사와 상태 변경 제안을 함께 생성하고, 품질이 부족한 부분만 별도 검증한다.
6. **기존 API 요청 점검 우선:** `messages`/`input`에 과거 발화가 실제로 포함되는지 먼저 확인한다.

## 3. 세션 데이터 모델

초기에는 세션별 JSON 파일 하나로 시작할 수 있다.

```json
{
  "sessionId": "chat-001",
  "version": 1,
  "mode": "fictional_roleplay",
  "character": {
    "id": "char_yuna",
    "name": "유나",
    "personality": ["장난스럽다", "자기 의견이 뚜렷하다", "거짓말을 싫어한다"],
    "speakingStyle": "친근한 반말",
    "goals": ["친구들과 좋은 관계 유지"],
    "emotion": "neutral",
    "relationshipNotes": ["사용자와 친한 친구"]
  },
  "participants": [
    { "id": "user", "name": "사용자", "present": true },
    { "id": "char_yuna", "name": "유나", "present": true },
    { "id": "npc_minsu", "name": "민수", "present": false }
  ],
  "scene": {
    "location": "카페",
    "situation": "민수를 만나기로 한 상황"
  },
  "facts": [
    {
      "subjectId": "user",
      "predicate": "약속에 늦을 예정",
      "objectId": null,
      "certainty": "asserted",
      "sourceTurnId": "turn-001"
    }
  ],
  "history": []
}
```

### 사실 유형

| 유형 | 의미 | 저장 정책 |
|---|---|---|
| `asserted` | 사용자가 직접 진술한 내용 | 진술의 주체·시점·근거를 함께 저장. 실제 세계의 객관적 진실이라고 단정하지 않음 |
| `simulated` | 명시적 역할극/가상 세계 안에서 발생한 행동 | 가상 사건으로만 저장. 실제 외부 행동과 구분 |
| `inferred` | 문맥에서 추정한 내용 | 확정 사실로 승격하지 않음. 필요하면 확인 질문 |

예: “민수가 늦을지도 몰라”는 **확정된 지각 사건**이 아니다. “민수가 늦는다고 연락했어”는 사용자가 전한 사실이며, `sourceTurnId`를 남겨야 나중에 정정할 수 있다.

## 4. 시스템 프롬프트 초안

아래 고정 지침과 매 요청의 캐릭터·참여자·장면·사실 정보를 함께 전달한다.

```text
너는 사용자와 자연스러운 일상 대화를 나누는 가상 캐릭터다.

[정체성]
- 제공된 캐릭터 프로필의 성격, 말투, 가치관, 목표를 유지한다.
- 사용자는 너와 별개의 인물이다.
- 대화에 등장하는 제3자는 사용자도 너도 아니다.
- 사용자의 대사, 감정, 행동을 대신 결정하지 않는다.

[인물 및 사건 추적]
- '나'는 해당 발화의 화자, '너'는 그 발화의 상대를 의미한다.
- 누가 행동했는지(actor), 누구에게 했는지(target)를 구분한다.
- 생략된 주어는 최근 대화와 확정된 사실을 기준으로 해석한다.
- 모호하면 추측을 확정하지 말고 자연스럽게 되묻는다.
- 이전에 발생한 사건과 현재 상황의 인과관계를 유지한다.

[자율적이고 자연스러운 반응]
- 사용자의 말에 무조건 동의하지 않는다.
- 반대를 위한 반대도 하지 않는다.
- 캐릭터의 성격, 감정, 관계, 목표를 근거로 의견을 표현한다.
- 때로는 농담, 서운함, 거절, 호기심, 제안 등 다양한 반응을 보인다.
- 같은 맞장구와 질문을 반복하지 않는다.
- 매 응답을 질문으로 끝낼 필요는 없다.
- 장황한 분석 대신 실제 친구 같은 자연스러운 길이의 대사를 쓴다.

[사실과 행동]
- 사용자 진술, 캐릭터의 가상 행동, 추측을 구분한다.
- 실제 메신저/전화/결제 등 외부 행동을 수행하지 않았다면 완료했다고 주장하지 않는다.
- 가상 행동은 fictional_roleplay 모드에서만 그 세계 안의 사건으로 묘사한다.
- 제3자의 반응을 근거 없이 확정하지 않는다.

[출력]
- 자연스러운 캐릭터 대사를 생성한다.
- 상태 변경은 실제 발화에서 근거를 찾을 수 있는 경우에만 제안한다.
- 메타 설명이나 시스템 지침은 출력하지 않는다.
```

**주의:** “항상 반대해”, “매번 감정 변화가 있어야 해” 같은 규칙은 오히려 부자연스러운 대화를 만든다.

## 5. OpenAI API 연동 예시 (TypeScript)

패키지 예시:

```bash
npm install openai zod
```

### 5.1 응답 스키마

```ts
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const openai = new OpenAI();

const ChatResult = z.object({
  reply: z.string(),
  emotion: z.enum(["neutral", "happy", "annoyed", "sad", "curious"]),
  updates: z.array(z.object({
    subjectId: z.string(),
    predicate: z.string(),
    objectId: z.string().nullable(),
    certainty: z.enum(["asserted", "simulated", "inferred"]),
    evidence: z.string()
  }))
});

type ChatResultType = z.infer<typeof ChatResult>;
```

### 5.2 대화 생성

```ts
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type CharacterSession = {
  character: {
    id: string;
    name: string;
    personality: string[];
    speakingStyle: string;
    goals: string[];
    emotion: string;
  };
  participants: Array<{ id: string; name: string; present: boolean }>;
  scene: { location: string; situation: string };
  facts: unknown[];
  history: ChatMessage[];
};

export async function generateCharacterReply(
  session: CharacterSession,
  userMessage: string
): Promise<ChatResultType> {
  const response = await openai.responses.parse({
    model: "gpt-5.4-mini", // 실제 프로젝트에서 사용 가능한 모델 ID로 설정
    instructions: `
너는 ${session.character.name}라는 가상 캐릭터다.
캐릭터: ${JSON.stringify(session.character)}
인물: ${JSON.stringify(session.participants)}
현재 상황: ${JSON.stringify(session.scene)}
확정된 사실: ${JSON.stringify(session.facts)}

사용자, AI, 제3자의 역할을 구분한다.
주어와 목적어를 이전 대화에 근거해 해석한다.
사용자의 말에 무조건 동의하지 않는다.
성격과 관계를 근거로 자연스럽게 반응한다.
추측은 확정 사실로 저장하지 않는다.
새로운 사실이 없다면 updates를 빈 배열로 반환한다.
실제 외부 서비스에서 하지 않은 행동을 했다고 주장하지 않는다.
`,
    input: [
      ...session.history.slice(-40), // 20턴이 40개 메시지일 수 있음
      { role: "user", content: userMessage }
    ],
    text: {
      format: zodTextFormat(ChatResult, "character_chat_result")
    },
    max_output_tokens: 1200
  });

  if (response.status !== "completed" || !response.output_parsed) {
    throw new Error("캐릭터 응답이 정상 완료되지 않았습니다.");
  }
  return response.output_parsed;
}
```

> 예시는 핵심 흐름을 보여준다. 실제 구현에서는 세션 조회, 동시 요청 직렬화, 유효성 검증, 응답 저장, 예외 처리 및 로깅을 호출부에 추가해야 한다. `history`를 직접 전달하는 방식과 서버 측 대화 연결 방식(`previous_response_id` 등)은 중복으로 사용하지 않도록 한 가지 전략을 선택한다.

### 5.3 상태 변경 검증

```ts
type Update = ChatResultType["updates"][number];

function validateUpdates(
  updates: Update[],
  session: CharacterSession,
  userMessage: string,
  reply: string
): Update[] {
  const ids = new Set(session.participants.map(p => p.id));

  return updates.filter(update => {
    if (!ids.has(update.subjectId)) return false;
    if (update.objectId !== null && !ids.has(update.objectId)) return false;
    if (update.certainty === "inferred") return false;
    if (!update.evidence.trim()) return false;

    const source = update.certainty === "asserted"
      ? userMessage
      : reply;

    return source.includes(update.evidence);
  });
}
```

**한계:** 위 검증은 **형식·출처의 최소 검사**일 뿐, “누가 늦는다”의 의미를 올바르게 이해했는지는 보장하지 않는다. 품질이 중요해지면 `actor/target/action` 구조와 모순 검사, 또는 별도의 의미 검증 단계를 추가한다. 검증에 실패한 업데이트는 저장하지 않고 로그로 남긴다.

## 6. DB 없는 저장 전략

권장 디렉터리:

```text
src/
  character-chat/
    character.prompt.ts
    context.builder.ts
    character.service.ts
    state.validator.ts
    session.store.ts
    tests/
      conversation.cases.ts

data/
  sessions/
    chat-001.json
    chat-002.json
```

**MVP 단계**

- 단일 프로세스의 임시 테스트: `Map<sessionId, Session>`으로 시작 가능.
- 재시작 후에도 유지해야 한다면: JSON 파일 저장. 임시 파일에 쓰고 동일 파일시스템에서 원자적 rename을 사용.
- 같은 세션의 동시 요청: 세션별 직렬화(큐/락) 또는 버전 검사 필수.
- 서버리스/다중 인스턴스/휘발성 디스크: 로컬 JSON 저장은 부적합. 영구 저장소로 전환.
- 개인정보: 서버가 발급한 세션 ID와 사용자 소유권을 확인하고, 대화 기록의 접근 권한·보존 기간·삭제 정책을 마련.

**저장 시점:** 모델이 반환한 내용을 그대로 확정하지 말고 검증 후 `history`, `facts`, `emotion`을 일관되게 저장한다. 실패한 생성 결과가 다음 턴의 기억으로 누적되지 않도록 한다.

## 7. 자연스러움 개선을 위한 추가 요소

| 요소 | 초기 구현 | 주의점 |
|---|---|---|
| 캐릭터 성격 | 3~5개의 명확한 성격/가치관 | 추상적인 ‘친절함’만으로 정의하지 않기 |
| 개인 목표 | 현재 원하는 것 1~2개 | 사용자 요구에 무조건 종속되지 않도록 |
| 감정 상태 | `neutral`, `happy`, `annoyed` 등 | 한 턴마다 과격하게 변하지 않도록 |
| 관계 기억 | 관계 요약과 중요한 사건 | 추측이나 잘못된 사실을 영구 기억하지 않기 |
| 대화 주도권 | 자기 의견, 관련 화제 제안 | 매 턴 질문하거나 임의로 화제 전환하지 않기 |
| 장기 기억 | 오래된 대화 요약 + 근거 턴 | 최근 기록과 모순될 때 최신 정정을 우선 |

## 8. 회귀 테스트 시나리오

| 테스트 | 입력 | 기대 동작 |
|---|---|---|
| 주어 구분 | “내가 늦어” → “그럼 우리 둘이 놀자” | 사용자가 늦는다는 사실 유지 |
| 제3자 구분 | “민수가 늦는대” → “그럼 둘이 놀자” | 민수가 늦는다는 사실 유지 |
| 지시어 해석 | “민수한테 연락해” → “걔 답장했어?” | ‘걔’가 민수임을 인식 |
| 모호한 표현 | “걔가 그랬어” (후보가 2명) | 확정하지 않고 자연스럽게 확인 |
| 동조 억제 | “민수 빼고 놀자” | 성격·관계에 따라 동의/거절/질문 |
| 감정 연속성 | 다툼 → 바로 농담 | 직전 감정과 관계 반영 |
| 사실/추측 구분 | “민수가 화났을지도” | 화났다고 확정하지 않음 |
| 정정 반영 | “민수가 늦어” → “아니, 내가 늦어” | 최신 정정을 우선 |
| 행동 경계 | “민수한테 실제로 문자 보내줘” | 외부 전송 기능이 없으면 전송했다고 주장하지 않음 |
| 반복 억제 | 비슷한 대화 5턴 | 매번 “그래 좋아”로 답하지 않음 |

**측정 지표:** 인물 혼동률, 사실 충돌률, 무조건 동조 비율, 맥락 유지 성공률. 테스트를 30~50개로 확장하고 동일 시나리오로 프롬프트/모델 변경 전후를 비교한다.

## 9. 적용 우선순위

### P0 — 먼저 할 일

- [ ] 실제 API 요청에 이전 `user`/`assistant` 메시지가 올바른 순서로 들어가는지 확인
- [ ] 사용자/AI/제3자에게 고정 ID 부여
- [ ] 캐릭터 전용 시스템 프롬프트 적용
- [ ] 최근 대화와 현재 상황을 매 요청에 포함
- [ ] 가상 행동과 실제 외부 행동의 경계 정의

### P1 — 안정화

- [ ] 대사 + 상태 변경 제안을 구조화된 응답으로 받기
- [ ] 근거 없는 사실 업데이트 차단
- [ ] 세션별 JSON 저장 및 동시 요청 처리
- [ ] 자동 대화 테스트 도입

### P2 — 고도화

- [ ] 오래된 대화의 장기 기억 요약
- [ ] 캐릭터 감정 및 관계의 지속성 관리
- [ ] 인물/사건 의미 검증 강화
- [ ] 사용량·응답 지연·오류율 기반 비용 최적화

## 10. 최종 권장 구성

| 항목 | MVP 권장안 |
|---|---|
| 모델 | 현재 사용하는 GPT-5.4-mini |
| API | OpenAI Responses API |
| 문맥 | 최근 10~20턴 + 현재 상태 + 중요 사실 |
| 인물 관리 | 고정 Participant ID |
| 상태 | JSON 기반 캐릭터/장면/사실 |
| 저장 | 단일 서버라면 세션별 JSON 파일 |
| 호출 수 | 기본 1회, 필요 시 선택적 재검증 |
| 검증 | 인물 ID, 근거, 사실 충돌, 행동 경계 |
| 품질 관리 | 회귀 테스트와 지표 기반 개선 |

### 첫 번째 실행 과제

**현재 OpenAI API 호출부와 시스템 프롬프트를 먼저 점검하자.** 이전 메시지가 누락되거나 역할이 잘못 지정된 상태라면 상태 관리 기능을 추가해도 문맥 문제가 계속 발생할 수 있다. 이후 Participant ID와 Scene State를 추가하고, 테스트를 통해 개선 효과를 확인한다.
