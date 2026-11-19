export function manuscriptSources(prose: string) {
  const parts = prose.split(/(?<=[.!?。！？])\s+|\n+/u).filter(part => part.trim());
  const chunks = parts.flatMap(part => Array.from({ length: Math.ceil(part.length / 360) }, (_, i) => part.slice(i * 360, (i + 1) * 360)));
  return chunks.map((text, i) => ({ id: `source_${i + 1}`, text }));
}

// References are constrained to supplied source IDs by the model output schema.
// Resolve them ourselves so the model cannot paraphrase or translate quotations.
export function resolveSources<T>(value: T, sources: { id: string; text: string }[]): T {
  const lookup = new Map(sources.map(source => [source.id, source.text]));
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => {
      if (key !== "evidence"&&key!=="changeEvidence") return [key, visit(child)];
      if(key==="changeEvidence"&&child===null)return [key,null];
      const quote = typeof child === "string" ? lookup.get(child) : undefined;
      if (!quote) throw new Error("Invalid manuscript source");
      return [key, quote];
    }));
  };
  return visit(value) as T;
}
