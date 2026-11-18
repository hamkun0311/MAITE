export function readingKey(owner: string, novel: string) { return `maite-reading:${owner}:${novel}`; }
export function readChapter(owner: string, novel: string) {
  try { const value=Number(localStorage.getItem(readingKey(owner,novel))); return Number.isSafeInteger(value)&&value>0?value:1; } catch { return 1; }
}
export function saveChapter(owner: string, novel: string, chapter: number) {
  try { localStorage.setItem(readingKey(owner,novel),String(chapter)); } catch { /* Reading remains available without storage. */ }
}
