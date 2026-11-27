import { z } from "zod";

export const newCharacterRenderStyles = ["cinematic-anime", "detailed-game-anime", "modern-cel-anime", "chibi-game"] as const;
export const selectableRenderStyle = z.enum(newCharacterRenderStyles);
export const renderStyleLabels: Record<z.infer<typeof selectableRenderStyle>, string> = {
  "cinematic-anime": "부드러운",
  "detailed-game-anime": "화려한",
  "modern-cel-anime": "또렷한",
  "chibi-game": "귀여운",
};
export const legacyCharacterRenderStyles = ["cel-animation", "watercolor", "storybook-gouache", "graphic-ink"] as const;
export const characterRenderStyle = z.enum([...newCharacterRenderStyles, ...legacyCharacterRenderStyles]);
export type CharacterRenderStyle = z.infer<typeof characterRenderStyle>;

export const characterStyleHeader = "X-Character-Render-Style";

const treatments: Record<CharacterRenderStyle, string> = {
  "cinematic-anime": "Cinematic 2D anime illustration with very fine color-tinted outlines, delicate hair strands and softly painted tonal transitions. Model skin and fabric with soft bounced light and detailed folds. Use luminous rim highlights, atmospheric depth and a restrained warm-light/cool-shadow balance suited to the scene.",
  "detailed-game-anime": "Richly detailed anime game key art with clean layered linework, saturated local colors, crisp cel-shadow shapes and selective gradient transitions. Use sharply drawn golden or colored specular accents, ribbon-like hair highlights, bright iris reflections and distinct rendering for the materials already present. Keep the silhouette clear and give existing accessories intricate finish.",
  "modern-cel-anime": "Contemporary 2D anime frame with tapered dark contours, broad flat color areas, and one or two clean graphic shadow shapes. Use a limited palette, clear warm-versus-cool separation, simple block highlights and clean facial linework. Keep surfaces smooth and small textures sparse.",
  "chibi-game": "Polished 2D chibi game illustration. For characters present in the brief, use a proportionally large head, compact rounded limbs, big clear eye shapes and a simplified readable silhouette while retaining recognizable age cues and design. Use saturated base colors, broad faceted cel shadows, soft localized transitions and bright highlights. Simplify detail into clean shapes.",
  "cel-animation": "Hand-drawn 2D cel-animation illustration. Use clean tapered contours, broad opaque color shapes, two crisp levels of shadow and small, sharp highlights. Keep surface texture smooth and let silhouettes and expressions read clearly.",
  watercolor: "Transparent watercolor and fine pencil illustration on softly grained paper. Use overlapping translucent washes, softly diffused pigment edges, reserved paper highlights and delicate colored pencil contours. Keep facial features readable against the loose washes.",
  "storybook-gouache": "Hand-painted storybook gouache illustration. Use opaque matte color blocks, layered dry-brush marks, softly blended edges and lightly textured highlights. Build forms with broad painterly strokes and use sparse contours.",
  "graphic-ink": "Color graphic-novel illustration with bold brush-ink outlines, varied line weight, selective hatching and flat spot colors. Use strong graphic shadow shapes, intentional negative space and sharp silhouettes.",
};

export function renderStyleDirection(style: CharacterRenderStyle) {
  const scope = style === "chibi-game"
    ? "Apply this treatment to linework, color, shading and stylized proportions. Preserve the brief's identity, age cues, expression, outfit, composition and scene lighting."
    : "This is the authoritative treatment for linework, color and shading. Follow the brief for character design, expression, outfit, composition and scene lighting.";
  return `Fixed rendering style: ${treatments[style]} ${scope}`;
}
