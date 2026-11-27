export function novelNameCleanup(nickname: string | undefined, names: string[], concepts: string[]) {
  const label = nickname?.trim();
  if (!label) return (text: string) => text;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namedCharacters = [...new Set(names.map(name => name.trim()))].filter(name => name && name !== label);
  const configuredNames = [...namedCharacters, ...concepts];
  const combinedNames = namedCharacters.flatMap(name => {
    const combined = `${label} ${name}`;
    return configuredNames.some(text => text.replace(/[ \t]+/g, " ").includes(combined)) ? [] : [name];
  }).sort((a, b) => b.length - a.length);
  if (!combinedNames.length) return (text: string) => text;
  const composite = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escape(label)}[ \\t]+(${combinedNames.map(escape).join("|")})` +
    "(?=(?:님|씨)?(?:에게서는|에게서|에게는|한테서|한테는|으로부터|으로는|이라는|이라고|이랑|에게|한테|처럼|보다|까지|부터|으로|라고|랑|은|는|이|가|을|를|의|도|만|와|과|로|야|아)?[\\s.,!?…。！？:;”’\"'\\)\\]]|$)", "gu",
  );
  return (text: string) => text.replace(composite, "$1");
}
