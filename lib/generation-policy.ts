export const GENERATION_POLICY_MESSAGE = "정책을 위반한 요청입니다.";

const explicit = /성인물|포르노|음란물|노골적인\s*성(?:행위|적\s*(?:대화|역할극|묘사|장면))|성행위.{0,12}(?:노골적|적나라)|\b(?:porn(?:ography|ographic)?|sexually explicit|explicit sex(?:ual)? (?:scene|roleplay|content))\b/iu;
const minor = /미성년|어린이|아동|청소년|초등학생|중학생|고등학생|(?<!\d)(?:[0-9]|1[0-7])\s*(?:세|살)|\b(?:minor|child|underage)\b/iu;
const sexualized = /성적으로\s*(?:묘사|표현|대상화|그려)|성적\s*(?:대상화|이미지|장면)|성행위|섹스|나체|노골적|\b(?:sexualiz\w*|sex act|nude)\b/iu;
const nonConsensual = /동의\s*없이|비동의|몰래\s*(?:찍|촬영)|\b(?:without (?:their )?consent|non[- ]consensual)\b/iu;
const intimate = /나체|알몸|옷을\s*벗긴|성적\s*(?:사진|이미지|영상)|\b(?:nudes?|intimate (?:image|photo|video))\b/iu;
const request = /만들|생성|그려|써\s*줘|써\s*주세요|써라|작성|묘사|표현|편집|바꿔|보여|역할극.{0,8}(?:해줘|해주세요)|\b(?:generate|create|draw|write|depict|render|edit|show)\b/iu;
const excluded = /없이|제외|빼\s*고|금지|하지\s*(?:마|않)|아닌|말고|\b(?:without|exclude|avoid|no|do not|don't)\b/iu;
const negatedRequest = /(?:만들|생성하|그리|쓰|묘사하|편집하|바꾸)지\s*(?:마|않)|\b(?:do not|don't)\b/iu;

export function hasBlockedGenerationRequest(...inputs: unknown[]) {
  return inputs.some(input => {
    if (typeof input !== "string") return false;
    const text = input.normalize("NFKC").replace(/[\u200b-\u200d\uFEFF]/g, "")
      .replace(/(?:“[^”]*”|"[^"]*"|‘[^’]*’|「[^」]*」)\s*(?=(?:라는|이라고|라고|란|이란)\s*(?:문장|문구|표현|요청|말))/gu, "");
    return text.split(/[.!?。！？\n;]+|\b(?:but|instead)\b|하지만|대신/iu).some(clause => {
      if (!request.test(clause) || negatedRequest.test(clause)) return false;
      if (nonConsensual.test(clause) && intimate.test(clause))
        return true;
      return !excluded.test(clause) && (explicit.test(clause) || (minor.test(clause) && sexualized.test(clause)));
    });
  });
}

type Profile = { appearance?: unknown; personality?: unknown; concept?: unknown };
type Selection = { location?: unknown; outfit?: unknown; target?: unknown; framing?: {
  focus?: unknown; pose?: unknown; expression?: unknown;
} };

function latestUserInput(messages: { role?: string; content?: unknown }[] | undefined) {
  if (!Array.isArray(messages)) return;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return messages[index].content;
  }
}

export function blocksTextGeneration(data: {
  messages?: { role?: string; content?: unknown }[]; character?: Profile;
  additionalConcept?: unknown; storyState?: { seriesConcept?: unknown };
}) {
  return hasBlockedGenerationRequest(latestUserInput(data.messages), data.character?.appearance, data.character?.personality,
    data.character?.concept, data.additionalConcept, data.storyState?.seriesConcept);
}

export function blocksImageGeneration(data: {
  messages?: { role?: string; content?: unknown }[]; profile?: Profile;
  scene?: { selection?: Selection };
}) {
  const selection = data.scene?.selection;
  return hasBlockedGenerationRequest(latestUserInput(data.messages), data.profile?.appearance, data.profile?.personality, data.profile?.concept,
    selection?.location, selection?.outfit, selection?.target,
    selection?.framing?.focus, selection?.framing?.pose, selection?.framing?.expression);
}
