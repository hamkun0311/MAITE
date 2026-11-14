"use client";
import { useEffect, useRef, useState } from "react";
import type { CharacterProfile } from "@/lib/chat/character";
import { MAX_CHARACTER_IMAGE } from "@/lib/characters/schema";
import { MAX_GALLERY_IMAGES, type CharacterGalleryImage, type CharacterImageJob, type VisualKind } from "@/lib/characters/gallery";

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
  useEffect(() => () => {
    sequence.current++;
    controller.current?.abort();
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current.clear();
  }, []);

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
  function registerOriginal(blob: Blob, url: string, title: string) {
    clear();
    const original: CharacterGalleryImage = { id: "original", kind: "character", blob, url, title };
    imageRef.current = [original];
    setImages([original]);
    setBackgrounds({ chat: original.id, story: original.id });
  }
  function selectBackground(mode: "chat" | "story", id: string) {
    if (imageRef.current.some(image => image.id === id)) setBackgrounds(current => ({ ...current, [mode]: id }));
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
      body.set("scene", JSON.stringify({ kind, context: context.slice(-12000) }));
      body.set("messages", JSON.stringify([{ role: "user", content: reference.description.slice(0, 1600) + (kind === "illustration" ? "\n위 설명과 첨부 이미지는 인물 식별용입니다. scene.context의 최신 원고와 현재 상황에서 실제 현재 장소를 먼저 확정하고 그 장소의 장면을 그려주세요. 원본 배경·과거 장면·회상·앞으로 갈 장소는 현재 장소보다 우선하지 않습니다. 자세·손짓·표정·의상·소품·구도도 현재 장면에 맞게 새로 그려주세요." : "\n위 설명과 첨부 이미지는 인물 식별용입니다. 얼굴과 정체성을 유지하고 대화의 최신 의상과 현재 실제 장소를 함께 반영해주세요. 이동한 장소가 확인되면 원본의 배경보다 우선하고, 앞으로 갈 장소나 회상은 현재 장소로 오인하지 마세요.") }]));
      const response = await fetch("/api/characters", { method: "POST", body, signal: abort.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "이미지를 생성하지 못했습니다. 다시 시도해주세요.");
      }
      if (!response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("이미지 응답 형식이 올바르지 않습니다.");
      const blob = await response.blob();
      if (id !== sequence.current) return null;
      if (!blob.size || blob.size > MAX_CHARACTER_IMAGE) throw new Error("생성된 이미지 크기를 확인해주세요.");
      const title = decodeURIComponent(response.headers.get("X-Character-Title") || (kind === "illustration" ? "이야기 삽화" : "변경한 의상"));
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      const image: CharacterGalleryImage = { id: `${kind}-${id}`, url, title, blob, kind };
      imageRef.current = [...imageRef.current, image];
      setImages(imageRef.current);
      setBackgrounds(current => ({ ...current, [mode]: image.id }));
      return image;
    } catch (failure) {
      if (id === sequence.current) setError(abort.signal.aborted ? "이미지 생성 시간이 초과되었습니다. 다시 시도해주세요." : failure instanceof Error ? failure.message : "이미지를 생성하지 못했습니다.");
      return null;
    } finally {
      clearTimeout(timeout);
      if (id === sequence.current) { controller.current = null; setJob(undefined); }
    }
  }
  return { images, backgrounds, job, error, cancel, clear, registerOriginal, selectBackground, generate };
}
