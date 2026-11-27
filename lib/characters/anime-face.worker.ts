import { detectAnimeFace, faceThumbnailPosition } from "./anime-face.ts";

self.onmessage = ({ data }: MessageEvent<{ key: string; pixels: Uint8ClampedArray; width: number; height: number }>) => {
  const { key, pixels, width, height } = data;
  const face = detectAnimeFace(pixels, width, height);
  self.postMessage({ key, position: face ? faceThumbnailPosition(face, width, height) : null });
};
