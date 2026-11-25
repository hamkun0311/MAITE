const particles = [
  ["으로", "로"], ["이랑", "랑"], ["이나", "나"],
  ["이라고", "라고"], ["이에요", "예요"],
  ["은", "는"], ["이", "가"], ["을", "를"], ["과", "와"], ["아", "야"],
] as const;
const fixedParticles = ["한테서", "에게서", "으로부터", "로부터", "한테", "에게", "께서", "에서", "부터", "까지", "처럼", "보다", "의", "도", "만", "께", "에"];
const particlePattern = [...particles.flat(), ...fixedParticles].sort((a, b) => b.length - a.length).join("|");
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function personalizeNovelText(text: string, authorNickname: string, buyerNickname: string) {
  if (!authorNickname || !buyerNickname || authorNickname === buyerNickname) return text;
  const name = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escapePattern(authorNickname)}(?:(${particlePattern})([는도만]?))?(?![\\p{L}\\p{M}\\p{N}_])`, "gu");
  const last = buyerNickname.charCodeAt(buyerNickname.length - 1) - 0xac00;
  // Hangul blocks encode the final consonant in the last index. Other scripts keep the original particle.
  const final = last >= 0 && last <= 11171 ? last % 28 : undefined;
  return text.replace(name, (_match, particle: string | undefined, suffix: string | undefined) => {
    if (!particle || final === undefined) return buyerNickname + (particle ?? "") + (suffix ?? "");
    if (particle === "로" || particle === "으로") return buyerNickname + (final === 0 || final === 8 ? "로" : "으로") + (suffix ?? "");
    const pair = particles.find(pair => pair.some(form => form === particle));
    return buyerNickname + (pair ? pair[final ? 0 : 1] : particle) + (suffix ?? "");
  });
}
