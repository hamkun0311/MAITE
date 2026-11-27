"use client";

import { useState, type ReactEventHandler } from "react";
import CachedImage from "./CachedImage";
import { useAccount } from "./AccountProvider";

const STORAGE_KEY = "maite:character-thumbnail-position:v1";
type Position = string | null;
type Detection = { promise: Promise<Position | undefined>; resolve: (position: Position | undefined) => void };
const pending = new Map<string, Detection>();
let worker: Worker | undefined;
let positions: Map<string, Position> | undefined;

function thumbnailPositions() {
  if (positions) return positions;
  positions = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    for (const [key, position] of saved) {
      if (typeof key === "string" && (position === null || /^(?:100|\d{1,2})% (?:100|\d{1,2})%$/.test(position))) {
        positions.set(key, position);
      }
    }
  } catch { /* In private mode or after a corrupt cache, start with an empty cache. */ }
  return positions;
}

function detector() {
  if (worker) return worker;
  const instance = new Worker(new URL("../lib/characters/anime-face.worker.ts", import.meta.url), { type: "module" });
  instance.onmessage = ({ data }: MessageEvent<{ key: string; position: Position }>) => {
    pending.get(data.key)?.resolve(data.position);
    pending.delete(data.key);
  };
  instance.onerror = () => {
    instance.terminate();
    worker = undefined;
    for (const task of pending.values()) task.resolve(undefined);
    pending.clear();
  };
  return worker = instance;
}

async function findPosition(image: HTMLImageElement, key: string) {
  const cache = thumbnailPositions();
  if (cache.has(key)) return cache.get(key);
  const existing = pending.get(key);
  if (existing) return existing.promise;
  if (image.naturalWidth === image.naturalHeight || typeof Worker === "undefined") return undefined;
  const ratio = Math.min(1, 384 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * ratio);
  canvas.height = Math.round(image.naturalHeight * ratio);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  try {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const analyzer = detector();
    const { promise, resolve } = Promise.withResolvers<Position | undefined>();
    analyzer.postMessage({ key, pixels, width: canvas.width, height: canvas.height }, [pixels.buffer]);
    pending.set(key, { promise, resolve });
    const position = await promise;
    if (position === undefined) return undefined;
    cache.set(key, position);
    while (cache.size > 256) cache.delete(cache.keys().next().value!);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache].filter(([id]) => !id.includes("\nblob:"))));
    } catch { /* The in-memory cache still avoids repeating analysis in this tab. */ }
    return position;
  } catch { return undefined; }
}

export default function CharacterThumbnail({ src, cacheKey, alt }: { src: string; cacheKey?: string; alt: string }) {
  const { user } = useAccount();
  const key = `${user?.id || "demo"}\n${cacheKey || src}`;
  const [crop, setCrop] = useState<{ key: string; position: string }>();
  const onLoad: ReactEventHandler<HTMLImageElement> = event => {
    const image = event.currentTarget;
    if (Math.min(image.naturalWidth, image.naturalHeight) < 24) return;
    const loadedSrc = image.src;
    void findPosition(image, key).then(position => {
      if (position && image.isConnected && image.src === loadedSrc) setCrop({ key, position });
    });
  };
  return <CachedImage src={src} cacheKey={cacheKey} alt={alt} loading="lazy" onLoad={onLoad}
    style={crop?.key === key ? { objectPosition: crop.position } : undefined} />;
}
