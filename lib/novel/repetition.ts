type Passage = { text: string; normalized: string; paragraph: number; dialogue: boolean };

const normalize = (text: string) => text.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, "");
const shingles = (text: string) => new Set(Array.from({ length: text.length - 7 }, (_, index) => text.slice(index, index + 8)));

function similarNarration(first: string, second: string) {
  const shorter = Math.min(first.length, second.length);
  const longer = Math.max(first.length, second.length);
  if (shorter < 36 || shorter / longer < 0.8) return false;
  const a = shingles(first);
  const b = shingles(second);
  return [...a].filter(part => b.has(part)).length / Math.max(a.size, b.size) >= 0.8;
}

export function findRepeatedPassage(prose: string) {
  const passages: Passage[] = [];
  for (const [paragraph, text] of prose.split(/\r?\n(?:[^\S\r\n]*\r?\n)+/).entries()) {
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
