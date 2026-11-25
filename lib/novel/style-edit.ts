import { z } from "zod";

export const fiveEventDraftSchema = z.object({ events: z.array(z.string().trim().min(1)).length(5) }).strict();

function readJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch { return undefined; }
}

export function parseStyleEditResponse(raw: string) {
  const text = raw.trim().replace(/\r\n/g, "\n");
  const json = readJson(text);
  if (json !== undefined) {
    const direct = fiveEventDraftSchema.safeParse(json);
    return direct.success ? { format: "json", draft: direct.data } : undefined;
  }

  // Only extract the known object shape. Quotes and brackets inside an event are prose.
  const objects = [...text.matchAll(/\{\s*"events"\s*:\s*\[(?:[^"\[\]]|"(?:\\.|[^"\\])*")*\]\s*\}/gu)];
  if (objects.length) {
    if (objects.length !== 1) return;
    const wrapped = fiveEventDraftSchema.safeParse(readJson(objects[0][0]));
    return wrapped.success ? { format: "wrapped_json", draft: wrapped.data } : undefined;
  }

  const markers = [...text.matchAll(/^\[(EVENT [1-5]|END EVENTS)\][ \t]*$/gm)];
  if (markers.length !== 6 || text.slice(0, markers[0].index).trim() ||
      markers[5][1] !== "END EVENTS" || text.slice(markers[5].index + markers[5][0].length).trim()) return;
  const starts = markers.slice(0, 5);
  if (starts.some((marker, i) => marker[1] !== `EVENT ${i + 1}`)) return;
  const events = starts.map((marker, i) => text.slice(marker.index + marker[0].length, markers[i + 1].index));
  const marked = fiveEventDraftSchema.safeParse({ events });
  return marked.success ? { format: "marked_events", draft: marked.data } : undefined;
}
