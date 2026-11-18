export type Checkin = { id: string; body: string; user_turns: number; created_at: string; read_at?:string|null };
export type DisplayMessage = { role: "user" | "assistant"; content: string; checkinId?: string };
/** Insert greetings after the completed exchange they followed; never duplicate persisted rows. */
export function mergeCheckins<T extends DisplayMessage>(messages: T[], greetings: Checkin[]): (T | DisplayMessage)[] {
  const result: (T | DisplayMessage)[] = [...messages];
  for (const greeting of greetings) {
    if (result.some(message => message.checkinId === greeting.id)) continue;
    let turns = 0, insertion = result.length;
    for (let i = 0; i < result.length; i++) {
      if (result[i].role === "user" && ++turns > greeting.user_turns) { insertion = i; break; }
    }
    result.splice(insertion, 0, { role: "assistant", content: greeting.body, checkinId: greeting.id });
  }
  return result;
}
