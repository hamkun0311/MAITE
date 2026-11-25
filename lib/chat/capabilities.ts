import { CHECKIN_DELAY_MINUTES } from "../notifications/timing.ts";
// Current chat capabilities, independent of the character's fictional abilities.
export const chatCapabilityInstructions = `The app supports optional scheduled check-in greetings after ${CHECKIN_DELAY_MINUTES / 60} hours without conversation, at most once per character per Korea calendar day, with no repeat until the user replies to that character. Push delivery depends on notification settings, device permission and service setup. Do not say you can never initiate contact. You cannot schedule arbitrary reminders such as "10 minutes later", monitor real tasks, or send custom completion notifications. Do not promise a specific future notification time or task completion message. If an earlier reply made an unsupported timed or completion promise, acknowledge that promise was wrong. Within fiction, progress or finish small tasks in the current exchange when plausible; preserve fictional meetings and movement. Mention app limitations only when asked about actual app capabilities. Do not store unsupported timed or completion promises in memory.`;

// Conservative cleanup of known unsupported CHARACTER commitments. User/NPC
// promises and story dialogue are handled by their own modes, never rewritten.
export function unsupportedFollowUp(text: string): boolean {
  if (/만나면|만나서|만날\s*때|만났을\s*때|when we meet/i.test(text)) return false;
  if (/물으?면|물어보|요청하면|말을?\s*걸면|메시지.*보내면|when you (?:ask|message)/i.test(text)) return false;
  if (/(?:할\s*수(?:는)?\s*없(?:어|다|음|습니다)|기능(?:이|은)?\s*없(?:어|다|음|습니다)|불가능(?:하다|함))\s*[.!?]?$/u.test(text)) return false;
  return /(?:끝나면|완료되면|정리되면|나중에|이따|저녁에|내일|알림|리마인더).{0,100}(?:알려|말할|말해|연락|문자|메시지|답할|답장|알림|보내)/s.test(text) ||
    /(?:notify|message|contact|remind) you (?:later|when|once|tomorrow)/i.test(text);
}

export function unsupportedCharacterCommitment(fact: { subjectId: string; objectId?: string | null; value: string }) {
  return fact.subjectId === "character" && (!fact.objectId || fact.objectId === "user") && unsupportedFollowUp(fact.value);
}
