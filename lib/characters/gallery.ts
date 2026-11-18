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
export type IllustrationScene = { novelId: string; chapter: number };
export function novelIllustration<T extends { id: string; kind: string; scene?: IllustrationScene; jobId?: string }>(images: T[], novelId: string | undefined, chapter: number, preferredId?: string): T | undefined {
  const available = images.filter(image => image.kind === "illustration" && image.jobId && image.scene && image.scene.novelId === novelId && image.scene.chapter <= chapter);
  const latestChapter = Math.max(0, ...available.map(image => image.scene!.chapter));
  const matching = available.filter(image => image.scene!.chapter === latestChapter);
  return matching.find(image => image.id === preferredId) ?? matching.at(-1);
}
export type VisualKind = "illustration" | "outfit";
export type CharacterGalleryImage = {
  id: string;
  url: string;
  thumbnailUrl?: string;
  blob: Blob;
  title: string;
  kind: "character" | VisualKind;
  scene?: IllustrationScene;
  composition?: { pose: string; framing: string };
  jobId?: string;
  listingId?: string;
};
export type CharacterImageJob = { kind: VisualKind; mode: "chat" | "story"; keywords?: string[] };
