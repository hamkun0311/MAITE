// Internal clock-and-location headings are standalone lines. Leave time
// expressions in dialogue and narrative sentences alone.
export function stripStoryMetadata(prose: string) {
  const heading = /^[ \t]*(?:#{1,6}[ \t]+)?(?:\*{1,2})?(?:[01]\d|2[0-3]):[0-5]\d[ \t]*[·|｜][ \t]*[^\r\n.!?。！？“”"‘’]{1,100}(?=\r?$)(?:\r?\n[ \t]*)*/gm;
  const standaloneMarkers = /^[ \t]*\[(?:[ \t]*\d+(?:[ \t]*,[ \t]*\d+)*[ \t]*|이벤트[ \t]+(?:시작|종료))\][.!。]?[ \t]*(?:\r?\n|$)/gm;
  const numericReferences = /[ \t]*\[[ \t]*\d+(?:[ \t]*,[ \t]*\d+)*[ \t]*\](?:[ \t]*(?=[,.!?。！？…;:)\]”"’']|$))?/gm;
  const trailingMarkers = /[ \t]+\[이벤트[ \t]+(?:시작|종료)\](?=[.!?。！？](?:\s|$)|[ \t]*(?:\r?$))/gm;
  return prose.replace(heading, "").replace(standaloneMarkers, "").replace(numericReferences, "").replace(trailingMarkers, "").trim();
}

export function formatStoryForReading(prose: string) {
  return stripStoryMetadata(prose)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]*(“[^“”\r\n]+”|"[^"\r\n]+")[ \t]*/g, (match: string, quote: string, offset: number, text: string) => {
      const next = text[offset + match.length] ?? "";
      // A quote with a directly attached particle is part of the narrative sentence.
      if (match.endsWith(quote) && /[\p{L}\p{N},.;:!?。！？]/u.test(next)) return match;
      let previousIndex = offset - 1;
      while (previousIndex >= 0 && /[ \t]/.test(text[previousIndex])) previousIndex--;
      const previous = text[previousIndex] ?? "";
      const spokenTurn = !previous || /[\n.!?…。！？:”"]/.test(previous) ||
        /[.!?…。！？][ \t]*[”"]$/.test(quote);
      return spokenTurn ? `\n\n${quote}\n\n` : match;
    })
    .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n")
    .trim();
}
