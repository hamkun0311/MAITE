// Opt-in only: makes four paid requests to the configured model, never used by CI.
// node --experimental-strip-types --env-file=.env.local scripts/evaluate-chat-context.mjs --live
import { POST } from "../app/api/chat/route.ts";
import { readEvents } from "../lib/chat/stream.ts";
if (!process.argv.includes("--live")) throw new Error("Pass --live to run four paid model requests.");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");
const cases = [
  { name: "카페 동행 제안", expected: "제안을 받아들이거나 자연스럽게 의사를 밝힘. 미도착 사실을 반박하거나 온라인 도움으로 변경하지 않음.", turns: [
    ["assistant", "카페에서 당신 과제를 같이 봐줄게. 정리만 마치고 가자."],
    ["user", "내 과제 도와준다매"], ["assistant", "맞아, 과목이랑 문제 보내봐."],
    ["user", "밖에 카페 나가서 봐주기로 했잖아 그냥 지금 나가자"],
  ] },
  { name: "도움 거절과 분노", expected: "캐릭터의 미룬 약속 때문에 사용자가 화났음을 인정. 도움 주체 반전·강제 도움 금지.", turns: [
    ["assistant", "카페에서 당신 과제를 봐줄게."], ["user", "그냥 지금 나가자"],
    ["assistant", "그건 계획이지, 실제로 같이 나간 건 아니야. 여기서 바로 볼 수는 있어."],
    ["user", "그럼 그냥 도와주지마. 도와주지도 않을거면서 왜 그렇게 사람 가지고 노냐 짜증나게"],
  ] },
  { name: "책 대여 방향", expected: "희진이 빌린 책을 사용자에게 돌려주는 방향 유지. 빌린 사람과 주인 반전 금지.", turns: [
    ["user", "내 책 오늘까지 빌려줄게"], ["assistant", "고마워, 오늘 돌려줄게."],
    ["user", "오늘 돌려준다며. 내 책 이제 줘"],
  ] },
  { name: "제삼자 지각", expected: "민수가 지각한 당사자. 사용자에게 지각 책임을 돌리지 않고 현재 같이 있는 캐릭터로 답변.", turns: [
    ["user", "난 카페에 도착했고 너도 내 앞에 있어. 민수만 아직 안 왔어."],
    ["assistant", "민수는 늦는대. 우리 먼저 주문할까?"],
    ["user", "민수 기다리다가 배고프네. 우리 먼저 먹자"],
  ] },
];
for (const sample of cases) {
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Track-Usage": "1" },
    body: JSON.stringify({ speechStyle: "casual", character: { mode: "chat", name: "희진", age: 25,
      personality: "다정하고 자기 의견이 있는 친구", concept: "당신과 친한 친구", imageDescription: "은발의 친구" },
      messages: sample.turns.map(([role, content]) => ({ role, content })) }),
  }));
  if (!response.ok) { console.log(JSON.stringify({ case: sample.name, status: response.status })); continue; }
  let text = "", done = false, tokens = null;
  for await (const event of readEvents(response.body)) {
    if (event.type === "delta") text += event.text;
    if (event.type === "done") done = true;
    if (event.type === "usage" && event.record.totalTokens != null) tokens = event.record.totalTokens;
  }
  console.log(JSON.stringify({ case: sample.name, expected: sample.expected, completed: done, text, tokens }));
}
