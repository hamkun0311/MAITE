export const MAX_GALLERY_IMAGES = 24;
export const NO_BACKGROUND = "none";
export function uniqueGalleryIds<T extends { id: string }>(images: T[]): T[] {
  const seen = new Set(images.map(image => image.id));
  const used = new Set<string>();
  return images.map(image => {
    if (!used.has(image.id)) { used.add(image.id); return image; }
    let id: string; do { id = `image-${crypto.randomUUID()}`; } while (seen.has(id) || used.has(id));
    used.add(id); return { ...image, id };
  });
}
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
