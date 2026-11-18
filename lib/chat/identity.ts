type IdentityContext = { concept: string; userName?: string };

/** Only explicit self-identification is extracted; unrelated named NPCs are not the user. */
export function userDisplayName(context: IdentityContext, additionalConcept = "") {
  const name = "([가-힣A-Za-z][가-힣A-Za-z0-9 _-]{0,39}?)";
  // Bare first-person sentences are ambiguous. Only a short name/title is
  // eligible here; a relationship clause must fall back to the account nickname.
  const selfName = "([가-힣A-Za-z][가-힣A-Za-z0-9_-]{0,11}?(?: [가-힣A-Za-z][가-힣A-Za-z0-9_-]{0,11}?)?)";
  for (const source of [additionalConcept, context.concept]) {
    const patterns = [
      new RegExp(`(?:나|사용자|당신|화자)의?\\s*(?:이름|호칭)\\s*(?:은|는|:|=)\\s*[‘'\"]?${name}(?=[’'\".,。\\n]|(?:이|라)다|$)`),
      new RegExp(`(?:나|사용자|당신|화자)\\s*\\(\\s*${name}\\s*\\)`),
      new RegExp(`(?:나를|사용자를|당신을)\\s*[‘'\"]${name}[’'\"](?:이?라고|으로)?\\s*부`),
      new RegExp(`(?:나는|사용자는|당신은|화자는)\\s+${selfName}(?:이다|이야|입니다|다)(?=[.。!,\\n]|$)`),
    ];
    for (const [index, pattern] of patterns.entries()) {
      const match = source.match(pattern); if (!match) continue;
      const candidate = match[1].trim();
      if (index === 3 && (/(?:와|과|의|에게|에서|하고|랑)\s|친구|친척|사이|사귀|사랑|좋아|싫어|다니|지내|행복|슬프|살고|살았|함께|부모님/.test(candidate))) continue;
      return candidate.slice(0, 80);
    }
  }
  return context.userName?.trim().slice(0, 80) || "당신";
}

export function userNamingInstructions(context: IdentityContext, additionalConcept = "") {
  return `User naming priority: explicit self-name or role/title assigned to the interacting person in the current concept > account nickname ${JSON.stringify(context.userName || "당신")}. Current resolved label: ${JSON.stringify(userDisplayName(context, additionalConcept))}. Interpret explicit concept self-designations (나/사용자/당신) as participant user; never assign an unrelated NPC's name to that person. Relationship/background clauses such as '나는 현아와 소꿉친구로 부모님들이 친구사이다' are NOT self-names or titles; retain the nickname. Use the concept's name/title when specified, otherwise the nickname with natural Korean particles. Never call this person 사용자, 유저, 화자 or 독자 in output. Keep stable internal ID user; do not rename other characters or rewrite quoted evidence. Older memory labels do not override this priority.`;
}
