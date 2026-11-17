"use client";
import { useEffect, useRef, useState } from "react";
import type { CharacterProfile } from "@/lib/chat/character";
import { MAX_CHARACTER_IMAGE } from "@/lib/characters/schema";
import { MAX_GALLERY_IMAGES, NO_BACKGROUND, type CharacterGalleryImage, type CharacterImageJob, type VisualKind } from "@/lib/characters/gallery";
import { compositionSchema } from "@/lib/characters/visual";
import { usageImageFetch } from "@/lib/usage-store";

type Reference = { blob: Blob; profile: CharacterProfile; style: string; description: string };
export default function useCharacterGallery(reference?: Reference) {
  const [images, setImages] = useState<CharacterGalleryImage[]>([]);
  const imageRef = useRef<CharacterGalleryImage[]>([]);
  const [backgrounds, setBackgrounds] = useState<{ chat?: string; story?: string }>({});
  const [job, setJob] = useState<CharacterImageJob>();
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const urls = useRef(new Set<string>());
  const [archive, setArchive] = useState<CharacterGalleryImage[]>([]);
  const archiveRef = useRef<CharacterGalleryImage[]>([]);
  useEffect(() => () => {
    sequence.current++;
    controller.current?.abort();
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current.clear();
    archiveRef.current.forEach(image => URL.revokeObjectURL(image.url));
    archiveRef.current = [];
  }, []);

  // The gallery owns separate URLs so a new character can clear its current
  // backgrounds without invalidating earlier generated images.
  function remember(image: CharacterGalleryImage) {
    const saved = { ...image, id: crypto.randomUUID(), url: URL.createObjectURL(image.blob) };
    const next = [saved, ...archiveRef.current];
    next.slice(MAX_GALLERY_IMAGES).forEach(image => URL.revokeObjectURL(image.url));
    archiveRef.current = next.slice(0, MAX_GALLERY_IMAGES);
    setArchive(archiveRef.current);
  }

  function cancel() {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    setJob(undefined);
    setError("이미지 생성을 취소했습니다. 다시 시도할 수 있습니다.");
  }
  function clear() {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current.clear();
    imageRef.current = [];
    setImages([]); setBackgrounds({}); setJob(undefined); setError("");
  }
  function clearArchive() {
    archiveRef.current.forEach(image => URL.revokeObjectURL(image.url)); archiveRef.current = []; setArchive([]);
  }
  function registerOriginal(blob: Blob, url: string, title: string) {
    clear();
    const original: CharacterGalleryImage = { id: "original", kind: "character", blob, url, title };
    imageRef.current = [original];
    setImages([original]);
    setBackgrounds({ chat: original.id, story: original.id });
    remember(original);
  }
  function selectBackground(mode: "chat" | "story", id: string) {
    if (id === NO_BACKGROUND || imageRef.current.some(image => image.id === id)) setBackgrounds(current => ({ ...current, [mode]: id }));
  }
  function restoreImages(saved: Omit<CharacterGalleryImage, "url">[], selected: { chat?: string; story?: string }) {
    const used = new Set(imageRef.current.map(image => image.id));
    const extra = saved.filter(image => image.id !== "original").map(image => {
      const id = used.has(image.id) ? `${image.kind}-${crypto.randomUUID()}` : image.id;
      used.add(id); return { ...image, id, url: URL.createObjectURL(image.blob) };
    });
    extra.forEach(image => { urls.current.add(image.url); remember(image); });
    imageRef.current = [...imageRef.current, ...extra].slice(0, MAX_GALLERY_IMAGES); setImages(imageRef.current);
    setBackgrounds(selected);
  }
  async function generate(mode: "chat" | "story", kind: VisualKind, context: string): Promise<CharacterGalleryImage | null> {
    if (controller.current || !reference || !context.trim()) return null;
    if (imageRef.current.length >= MAX_GALLERY_IMAGES) { setError("이 캐릭터의 이미지 보관 한도(24장)에 도달했습니다. 새 캐릭터로 시작해주세요."); return null; }
    const id = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    setJob({ kind, mode }); setError("");
    const timeout = setTimeout(() => abort.abort(), 280000);
    try {
      const body = new FormData();
      body.set("profile", JSON.stringify(reference.profile));
      body.set("previousStyle", reference.style);
      body.set("image", reference.blob, "original-character.jpg");
      body.set("scene", JSON.stringify({ kind, context: context.slice(-12000), previousCompositions: imageRef.current.filter(image => image.composition).slice(-3).map(image => image.composition) }));
      body.set("messages", JSON.stringify([{ role: "user", content: kind === "illustration"
        ? "현재 선택한 이야기 원고의 한 장면을 그려주세요. 현재 원고의 실제 등장인물·시점·실제 현재 장소를 우선합니다. 원본 캐릭터가 그 장면에 없으면 넣지 말고 다른 등장인물이나 풍경만 그려주세요. 첨부 이미지는 캐릭터가 실제 등장할 때만 인물 식별용입니다. 원본 배경·과거 장면·회상·앞으로 갈 장소는 현재 장소보다 우선하지 않습니다."
        : "첨부 이미지는 인물 식별용입니다. scene.context의 완료된 대화와 확정 기억에서 캐릭터의 최신 의상과 현재 실제 장소를 각각 확정해 새 장면을 그려주세요. 원본 생성 설명이나 캐릭터의 직업·초기 컨셉으로 현재 의상과 배경을 되돌리지 마세요. 얼굴·나이·머리·눈과 정체성은 유지하되 현재 장면에 맞게 배경·소품·자세를 새로 구성하고, 의상 변경이 없다면 최근 확정 의상을 유지해주세요. 앞으로 갈 장소나 회상은 현재 장소로 오인하지 마세요." }]));
      const response = await usageImageFetch(kind === "illustration" ? "삽화 생성" : "이미지 생성", "/api/characters", { method: "POST", body, signal: abort.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "이미지를 생성하지 못했습니다. 다시 시도해주세요.");
      }
      if (!response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("이미지 응답 형식이 올바르지 않습니다.");
      const blob = await response.blob();
      if (id !== sequence.current) return null;
      if (!blob.size || blob.size > MAX_CHARACTER_IMAGE) throw new Error("생성된 이미지 크기를 확인해주세요.");
      const title = decodeURIComponent(response.headers.get("X-Character-Title") || (kind === "illustration" ? "이야기 삽화" : "대화 장면"));
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      let composition: CharacterGalleryImage["composition"];
      try {
        const parsed = compositionSchema.safeParse(JSON.parse(decodeURIComponent(response.headers.get("X-Character-Composition") || "null")));
        if (parsed.success) composition = parsed.data;
      } catch { /* Older servers/invalid optional metadata must not discard the image. */ }
      const image: CharacterGalleryImage = { id: `${kind}-${crypto.randomUUID()}`, url, title, blob, kind, jobId: response.headers.get("X-Job-Id") ?? undefined, ...(composition ? { composition } : {}) };
      imageRef.current = [...imageRef.current, image];
      setImages(imageRef.current);
      setBackgrounds(current => current[mode] === NO_BACKGROUND ? current : ({ ...current, [mode]: image.id }));
      remember(image);
      window.dispatchEvent(new Event("maite-gallery-committed"));
      return image;
    } catch (failure) {
      if (id === sequence.current) setError(abort.signal.aborted ? "이미지 생성 시간이 초과되었습니다. 다시 시도해주세요." : failure instanceof Error ? failure.message : "이미지를 생성하지 못했습니다.");
      return null;
    } finally {
      clearTimeout(timeout);
      if (id === sequence.current) { controller.current = null; setJob(undefined); }
    }
  }
  return { images, archive, backgrounds, job, error, cancel, clear, clearArchive, registerOriginal, restoreImages, selectBackground, generate };
}
