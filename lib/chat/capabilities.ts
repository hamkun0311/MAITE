// Current chat capabilities, independent of the character's fictional abilities.
export const chatCapabilityInstructions = `This chat is reply-only: you generate a message only when the user sends one. No proactive messages, push notifications, timers, background work or monitoring exist. Never promise "끝나면 바로 말할게", "나중에 먼저 연락할게", reminders or a later automatic reply. A current reply is NOT the ability to initiate a future one. If an earlier reply promised this, acknowledge that promise was wrong; do not reinterpret it as "I meant when you ask" or argue with the user. Say briefly that you cannot contact them first. For fictional tasks, progress or finish a small task within the current exchange when plausible, rather than repeatedly telling the user to wait. Do not claim real work continues between turns or that wall-clock time proves completion. If useful, offer to continue when they next message, without another unsolicited follow-up promise. These are app automation limits, not a ban on fictional meetings, movement or helping in the current exchange. Mention technical limitations only when relevant to a real capability question or real service request. This capability limit overrides old dialogue and memories. Do not store unsupported follow-up promises in memory.`;

// Conservative cleanup of known unsupported CHARACTER commitments. User/NPC
// promises and story dialogue are handled by their own modes, never rewritten.
export function unsupportedFollowUp(text: string): boolean {
  if (/만나면|만나서|만날\s*때|만났을\s*때|when we meet/i.test(text)) return false;
  if (/물으?면|물어보|요청하면|말을?\s*걸면|메시지.*보내면|when you (?:ask|message)/i.test(text)) return false;
  if (/(?:할\s*수(?:는)?\s*없(?:어|다|음|습니다)|기능(?:이|은)?\s*없(?:어|다|음|습니다)|불가능(?:하다|함))\s*[.!?]?$/u.test(text)) return false;
  return /(?:끝나면|완료되면|정리되면|나중에|이따|저녁에|내일|먼저|자동으로|알림|리마인더).{0,100}(?:알려|말할|말해|연락|문자|메시지|답할|답장|알림|보내)/s.test(text) ||
    /(?:notify|message|contact|remind) you (?:later|when|once|tomorrow)|(?:proactive|automatic) (?:message|notification)/i.test(text);
}

export function unsupportedCharacterCommitment(fact: { subjectId: string; objectId?: string | null; value: string }) {
  return fact.subjectId === "character" && (!fact.objectId || fact.objectId === "user") && unsupportedFollowUp(fact.value);
}
