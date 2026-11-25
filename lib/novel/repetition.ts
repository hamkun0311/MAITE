type Passage = { text: string; normalized: string; paragraph: number; dialogue: boolean };

const normalize = (text: string) => text.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, "");
const shingles = (text: string, size: number) =>
  new Set(Array.from({ length: text.length - size + 1 }, (_, index) => text.slice(index, index + size)));

const composedReply = /(?:답장|(?:문자|메시지)에\s*대답)[^.?!。！？\r\n]{0,48}(?:적[어었]|쓰|써|작성|완성)/u;
const sentReply = /전송\s*버튼을?\s*(?:눌렀|누르(?:는\s*(?:순간|소리|감각)|자마자))/u;
const newExchange = /다시\s*(?:보냈|보내|전송)|재전송|(?:두\s*번째|또\s*다른|새로운|별도의)\s*(?:문자|메시지|답장)|(?:문자|메시지|답장)[^.?!。！？]{0,28}(?:도착|왔|받았)|전송\s*(?:실패|오류)|(?:잠시|며칠|몇\s*분|한참)\s*(?:후|뒤)|(?:떠올|회상|돌이켜)/u;

function repeatedReplySend(first: string, second: string) {
  return [first, second].every(paragraph => {
    const composed = paragraph.search(composedReply);
    const sent = paragraph.search(sentReply);
    return composed >= 0 && sent > composed && !newExchange.test(paragraph);
  });
}

const doorbell = /초인종|현관\s*(?:벨|종)/u;
const doorOpening = /문(?:이\s*열리|을\s*열[고었자])/u;
const namedGiftCarrier = /(?:^|\s)([가-힣]{2,8})(?:는|가)\s+[^.!?。！？\r\n]{0,42}(?:상자|선물|꾸러미)[^.!?。！？\r\n]{0,24}(?:들고|쥐고)/u;
const newVisit = /(?:다음\s*날|(?:잠시|한참|며칠|몇\s*(?:분|시간))\s*(?:후|뒤)|돌아왔|(?:다시|또)\s*(?:울렸|울리|찾아|왔)|회상|떠올)/u;

function giftArrivalVisitor(paragraph: string) {
  const bell = paragraph.search(doorbell);
  const opened = paragraph.search(doorOpening);
  return bell >= 0 && opened > bell ? paragraph.slice(opened).match(namedGiftCarrier)?.[1] : undefined;
}

function repeatedGiftArrival(first: string, second: string) {
  const visitor = giftArrivalVisitor(first);
  return !!visitor && visitor === giftArrivalVisitor(second) && !newVisit.test(second);
}

function similarNarration(first: string, second: string) {
  const shorter = Math.min(first.length, second.length);
  const longer = Math.max(first.length, second.length);
  if (shorter < 36 || shorter / longer < 0.8) return false;
  const a = shingles(first, 8);
  const b = shingles(second, 8);
  return [...a].filter(part => b.has(part)).length / Math.max(a.size, b.size) >= 0.8;
}

function narrationSentences(prose: string) {
  return prose.replace(/“[^”\r\n]+”|"[^"\r\n]+"/gu, "\n")
    .split(/(?<=[.!?…。！？])\s+|\r?\n+/u)
    .map(text => ({ text: text.trim(), normalized: normalize(text) }))
    .filter(sentence => sentence.normalized.length >= 25)
    .map(sentence => ({ ...sentence, phrases: shingles(sentence.normalized, 5) }));
}

export function findReplayedInsertion(addition: string, manuscript: string) {
  const inserted = narrationSentences(addition);
  if (inserted.length < 2) return;
  const existing = narrationSentences(manuscript);
  function overlaps(a: (typeof inserted)[number], b: (typeof existing)[number]) {
    const shared = [...a.phrases].filter(phrase => b.phrases.has(phrase)).length;
    return shared >= 6 && shared / Math.min(a.phrases.size, b.phrases.size) >= 0.12;
  }
  // Require two nearby actions in the same order so a shared prop or description alone is insufficient.
  for (const [index, first] of inserted.entries()) {
    const next = inserted.slice(index + 1, index + 3);
    if (!next.length) break;
    const replay = existing.findIndex((sentence, position) => overlaps(first, sentence) &&
      next.some(later => existing.slice(position + 1, position + 3).some(other => overlaps(later, other))));
    if (replay >= 0) return { first: existing.slice(replay, replay + 3).map(sentence => sentence.text).join(" "), kind: "action_sequence" as const };
  }
}

export function findRepeatedPassage(prose: string) {
  const passages: Passage[] = [];
  const paragraphs = prose.split(/\r?\n(?:[^\S\r\n]*\r?\n)+/);
  for (const [paragraph, text] of paragraphs.entries()) {
    const previous = paragraphs[paragraph - 1];
    if (previous && (repeatedReplySend(previous, text) || repeatedGiftArrival(previous, text))) {
      return { first: previous.trim(), repeated: text.trim(), kind: "action" };
    }
    const parts = text.split(/(“[^”\r\n]+”|"[^"\r\n]+")/u);
    for (const [index, part] of parts.entries()) {
      const dialogue = index % 2 === 1;
      const candidates = dialogue ? [part] : part.split(/(?<=[.!?…。！？])\s+/u);
      for (const candidate of candidates) {
        const normalized = normalize(candidate);
        if (normalized.length < (dialogue ? 24 : 30)) continue;
        const first = passages.find(prior => {
          if (prior.dialogue !== dialogue || (!dialogue && prior.paragraph === paragraph)) return false;
          return prior.normalized === normalized || (!dialogue && similarNarration(prior.normalized, normalized));
        });
        if (first) return { first: first.text, repeated: candidate.trim(), kind: dialogue ? "dialogue" : "narration" };
        passages.push({ text: candidate.trim(), normalized, paragraph, dialogue });
      }
    }
  }
}
