export const MAX_GALLERY_IMAGES = 24;
export type VisualKind = "illustration" | "outfit";
export type CharacterGalleryImage = {
  id: string;
  url: string;
  blob: Blob;
  title: string;
  kind: "character" | VisualKind;
};
export type CharacterImageJob = { kind: VisualKind; mode: "chat" | "story" };
