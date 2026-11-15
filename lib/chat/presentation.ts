import type { ChatMessage } from "./session.ts";
import type { StoryState } from "../novel/state.ts";
import type { ChatMemory } from "./memory.ts";

export function plainDialogue(text: string, mode: "prose" | "chat" = "prose") {
  const source = mode === "chat" ? text.replace(/__([^_\n]+)__/g, "$1") : text;
  return source
    .replace(/```[a-zA-Z]*[ \t]*\r?\n/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(mode === "chat" ? /[*`]+/g : /[*_`~]+/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-+•]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*[-=]{3,}\s*$/gm, "");
}

export function mentionsClothing(messages: ChatMessage[]) {
  return messages.slice(-20).some(message => /의상|옷|착장|차림|원피스|드레스|셔츠|블라우스|코트|재킷|자켓|패딩|점퍼|맨투맨|치마|스커트|바지|청바지|반바지|레깅스|니트|스웨터|가디건|후드|정장|수트|교복|잠옷|한복|갑옷|유니폼|수영복|목도리|신발|구두|부츠|운동화|유카타|기모노|치파오|아오자이|사리|하카마|하오리|도포|저고리|두루마기|생활복|작업복|운동복|트레이닝복|츄리닝|추리닝|파자마|티셔츠|티샤츠|탱크톱|민소매|나시|슬립|조끼|베스트|뷔스티에|케이프|망토|판초|카디건|튜닉|점프수트|멜빵|오버롤|살로펫|한푸|차도르|히잡|레인부츠|샌들|슬리퍼|로퍼|하이힐|스타킹|양말|타이츠|\b(?:outfit|dress|shirt|coat|raincoat|jacket|skirt|pants|jeans|suit|sweater|hoodie|cardigan|uniform|robe|boots|yukata|kimono|qipao|cheongsam|sari|saree|ao\s+dai|hakama|haori|hanbok|pajamas|pyjamas|tunic|jumpsuit|overalls|poncho|cape|vest|blazer|leggings|sandals|loafers|sneakers|socks|tights)\b/i.test(message.content));
}

export function visualContext(messages: ChatMessage[]) {
  return messages.slice(-12).map(message => `${message.role === "assistant" ? "캐릭터/이야기" : "사용자"}: ${plainDialogue(message.content)}`).join("\n\n").slice(-12000).trim();
}

export function outfitContext(messages: ChatMessage[], memory?: ChatMemory) {
  const facts = memory?.facts.filter(fact => ["user", "character"].includes(fact.subjectId) &&
    /location|outfit|cloth|wardrobe|attire|wear|situation|장소|의상|착장|옷|위치|상황/i.test(fact.action)).slice(-8)
    .map(({ subjectId, action, value, certainty, sourceTurnId }) => ({ subjectId, action, value, certainty, sourceTurnId }));
  const continuity = facts?.length ? `Established conversation continuity (not the original image setting; later explicit changes override older facts):\n${JSON.stringify({ participants: memory!.participants.filter(person => ["user", "character"].includes(person.id)), facts })}\n\n` : "";
  const heading = "Recent completed dialogue (latest last; distinguish the character's outfit from the user's):\n";
  const recent = messages.slice(-20).map(message => `${message.role === "assistant" ? "캐릭터" : "사용자"}: ${plainDialogue(message.content)}`).join("\n\n");
  return `${continuity}${heading}${recent.slice(-(12000 - continuity.length - heading.length))}`.trim();
}

export function illustrationContext(messages: ChatMessage[], memory?: Pick<StoryState, "summary" | "currentSituation">) {
  const chapters = messages.filter(message => message.role === "assistant");
  const prose = plainDialogue(chapters.at(-1)?.content ?? "").slice(-7500).trim();
  const previous = plainDialogue(chapters.at(-2)?.content ?? "").trim();
  // Keep both the arrival at a chapter's opening and its final location.
  const bridge = previous ? `Previous chapter (location continuity only, NOT the moment to illustrate):\n${previous.length <= 1800 ? previous : previous.slice(0, 900) + "\n[...]\n" + previous.slice(-900)}\n\n` : "";
  const continuity = memory ? [
    memory.summary && `Continuity summary (background knowledge, not a scene to redraw): ${memory.summary.slice(0, 1400)}`,
    memory.currentSituation && `Current situation after the latest chapter: ${memory.currentSituation.slice(0, 400)}`,
  ].filter(Boolean).join("\n") : "";
  return `${continuity ? continuity + "\n\n" : ""}${bridge}Latest completed chapter (current action):\n${prose}`;
}
