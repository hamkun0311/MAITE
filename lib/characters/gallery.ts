export const MAX_GALLERY_IMAGES = 24;
export const NO_BACKGROUND = "none";
export type VisualKind = "illustration" | "outfit";
export type CharacterGalleryImage = {
  id: string;
  url: string;
  blob: Blob;
  title: string;
  kind: "character" | VisualKind;
  composition?: { pose: string; framing: string };
  jobId?: string;
};
export type CharacterImageJob = { kind: VisualKind; mode: "chat" | "story" };
