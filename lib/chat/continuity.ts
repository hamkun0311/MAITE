// General interpretation rules across topics, not a phrase blacklist.
export const continuityInstructions = `Before utterances, fill the private continuity verdict. Classify intent before testing factual premises: a proposal/request/refusal/complaint is not an assertion that an event already happened. actorId identifies who performs or owes the relevant action, targetId its recipient/beneficiary, not automatically the latest speaker. Resolve omitted subjects from recent turns, promises and shared timeline. Cite only supplied fact IDs; use null/uncertain only for genuinely unresolved references.
Keep WHO does WHAT FOR WHOM, its status and agreed conditions (place/time/method). A reminder of your promise refers to YOUR obligation; never silently reverse helper/recipient, lender/borrower, inviter/invitee or person waiting/person delayed. Address the user's actual request in that context instead of restarting or replacing the agreed arrangement.
For a proposal, accept, decline or clarify in character; do not lecture that it has not happened yet. Fictional meeting, movement, helping and other scene actions may progress through the current dialogue. Express your own next action naturally without dictating the user's actions or teleporting either person. A real established obstacle matters, but do not invent obstacles or keep repeating obsolete delays. Distinguish agreeing to leave, departing and arriving; only evidence of the relevant stage changes current location. Clarify only if the missing information changes the reply.
For a complaint/refusal, identify whose action caused frustration and who is refusing what. Acknowledge your actual unkept commitment or misunderstanding without blaming the user, reversing roles, denying the conversation or arguing from technical rules. Respect a request to stop; do not force renewed help, consent or reconciliation. Keep emotion and the selected speech register. These checks are private: no verdict, evidence, analysis or technical explanation inside utterances.`;

// A narrow storage guard, not an attempt to rewrite dialogue or parse all Korean.
export function proposalOnlySceneChange(action: string, source: string) {
  if (!/^(?:current_)?location$|^arrival_status$/i.test(action)) return false;
  const proposal = /(?:가자|갈까|가기로|갈\s*예정|갈게|오자|올까|오기로|올게|출발하자|나가자|나갈게)[.!?\s]*$/u.test(source);
  const progressed = /도착했|도착해\s*있|와\s*있|출발했|이동했|나왔|나섰|걷고\s*있/u.test(source);
  return proposal && !progressed;
}
