"use client";
import type { ImageSceneSelection } from "@/lib/characters/visual";
import { useEffect, useRef, useState } from "react";
import type { CharacterProfile } from "@/lib/chat/character";
import { MAX_CHARACTER_IMAGE } from "@/lib/characters/schema";
import { MAX_GALLERY_IMAGES, NO_BACKGROUND, type CharacterGalleryImage, type CharacterImageJob, type IllustrationScene, type VisualKind } from "@/lib/characters/gallery";
import { compositionSchema } from "@/lib/characters/visual";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { loadAccountImage, seedAccountImage } from "@/lib/platform/image-loader";
import { useAccount } from "./AccountProvider";
import { beginImageAttempt, requestImage } from "@/lib/platform/image-attempt";
import { visualKeywords } from "@/lib/chat/presentation";
import { blocksImageGeneration, GENERATION_POLICY_MESSAGE } from "@/lib/generation-policy";
import { useActionConfirm, useGenerationPolicyNotice } from "./ActionConfirm";

type Reference = { blob: Blob; profile: CharacterProfile; style: string; description: string; documentId: string };
export default function useCharacterGallery(reference?: Reference) {
  const showPolicyNotice = useGenerationPolicyNotice();
  const confirm = useActionConfirm();
  const { user } = useAccount(); const scope = user?.id || "demo";
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
  const hydrations = useRef(new Set<AbortController>());
  const galleryEpoch = useRef(0);
  useEffect(() => () => {
    sequence.current++;
    controller.current?.abort();
    hydrations.current.forEach(abort => abort.abort()); hydrations.current.clear();
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current.clear();
    archiveRef.current.forEach(image => URL.revokeObjectURL(image.url));
    archiveRef.current = [];
  }, []);

  // The gallery owns separate URLs so a new character can clear its current
  // backgrounds without invalidating earlier generated images.
  function remember(image: CharacterGalleryImage) {
    const saved = { ...image, id: crypto.randomUUID(), url: image.blob.size ? URL.createObjectURL(image.blob) : image.url };
    const next = [saved, ...archiveRef.current];
    next.slice(MAX_GALLERY_IMAGES).forEach(image => URL.revokeObjectURL(image.url));
    archiveRef.current = next.slice(0, MAX_GALLERY_IMAGES);
    setArchive(archiveRef.current);
    return saved.id;
  }

  function cancel() {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    setJob(undefined);
    setError("이미지 생성을 취소했습니다. 다시 시도할 수 있습니다.");
  }
  function clear() {
    galleryEpoch.current++;
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current.clear();
    imageRef.current = [];
    setImages([]); setBackgrounds({}); setJob(undefined); setError("");
  }
  function clearArchive() {
    hydrations.current.forEach(abort => abort.abort()); hydrations.current.clear();
    archiveRef.current.forEach(image => URL.revokeObjectURL(image.url)); archiveRef.current = []; setArchive([]);
  }
  function registerOriginal(blob: Blob, url: string, title: string, identity: { jobId?: string; listingId?: string } = {}) {
    clear();
    const original: CharacterGalleryImage = { id: "original", kind: "character", blob, url, title, ...identity };
    seedAccountImage(scope, imageAssetKey(original), blob);
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
  function originalLoaded(id: string, blob: Blob) {
    const target = imageRef.current.find(image => image.id === id) || archiveRef.current.find(image => image.id === id);
    if (!target || target.blob.size) return;
    const matches = (image: CharacterGalleryImage) => image.id === id || (!!target.jobId && image.jobId === target.jobId) || (!!target.listingId && image.listingId === target.listingId);
    let changed = false;
    imageRef.current = imageRef.current.map(image => {
      if (!matches(image) || image.blob.size) return image;
      const url = URL.createObjectURL(blob); urls.current.add(url); changed = true; return { ...image, blob, url };
    });
    if (changed) setImages(imageRef.current);
    archiveRef.current = archiveRef.current.map(image => matches(image) && !image.blob.size ? { ...image, blob, url: URL.createObjectURL(blob) } : image);
    setArchive(archiveRef.current);
  }
  function restoreRemoteImages(saved: Omit<CharacterGalleryImage, "url" | "blob">[], sources: Record<string, string>, selected: { chat?: string; story?: string }, thumbnails: Record<string, string> = {}) {
    const abort = new AbortController(); hydrations.current.add(abort);
    const epoch = galleryEpoch.current;
    const blank = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="72" height="128"%3E%3Crect width="100%25" height="100%25" fill="%23ede8f5"/%3E%3C/svg%3E';
    const extra = saved.filter(image => image.id !== "original").map(image => ({ ...image, blob: new Blob(), url: image.jobId && sources[image.jobId] || blank, thumbnailUrl: image.jobId && thumbnails[image.jobId] || undefined }));
    const archiveIds = new Map(extra.map(image => [image.id, remember(image)]));
    imageRef.current = [...imageRef.current, ...extra].slice(0, MAX_GALLERY_IMAGES);
    setImages(imageRef.current); setBackgrounds(selected);
    // Fetch only the currently selected backgrounds. Other originals load on fullscreen viewing.
    const needed = extra.filter(image => image.id === selected.chat || image.id === selected.story);
    void Promise.all(needed.map(async image => {
      if (!image.jobId || !sources[image.jobId]) return;
      try {
        const blob = await loadAccountImage(scope, imageAssetKey(image), sources[image.jobId]);
        if (!abort.signal.aborted) originalLoaded(epoch === galleryEpoch.current ? image.id : archiveIds.get(image.id)! , blob);
      } catch { /* Keep metadata and thumbnails when the original cannot be downloaded. */ }
    })).finally(() => { hydrations.current.delete(abort); });
  }
  async function generate(mode: "chat" | "story", kind: VisualKind, context: string, scene?: IllustrationScene, selection?: ImageSceneSelection): Promise<CharacterGalleryImage | null> {
    if (controller.current || !reference || !context.trim()) return null;
    if (blocksImageGeneration({profile:reference.profile, scene:{selection}})) { showPolicyNotice(); return null; }
    if (imageRef.current.length >= MAX_GALLERY_IMAGES) { setError("이 캐릭터의 이미지 보관 한도(24장)에 도달했습니다. 새 캐릭터로 시작해주세요."); return null; }
    const id = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    setJob({ kind, mode, keywords: visualKeywords(context) }); setError("");
    const timeout = setTimeout(() => abort.abort(), 280000);
    try {
      const body = new FormData();
      body.set("profile", JSON.stringify(reference.profile));
      body.set("previousStyle", reference.style);
      body.set("image", reference.blob, "original-character.jpg");
      body.set("scene", JSON.stringify({ kind, ...(selection ? { selection } : {}), context: context.slice(-12000), previousCompositions: imageRef.current.filter(image => image.composition).slice(-3).map(image => image.composition) }));
      body.set("messages", JSON.stringify([{ role: "user", content: kind === "illustration"
        ? "현재 선택한 이야기 원고의 한 장면을 그려주세요. 현재 원고의 실제 등장인물·시점·실제 현재 장소를 우선합니다. 원본 캐릭터가 그 장면에 없으면 넣지 말고 다른 등장인물이나 풍경만 그려주세요. 첨부 이미지는 캐릭터가 실제 등장할 때만 인물 식별용입니다. 원본 배경·과거 장면·회상·앞으로 갈 장소는 현재 장소보다 우선하지 않습니다."
        : "첨부 이미지는 인물 식별용입니다. scene.context의 완료된 대화와 확정 기억에서 캐릭터의 최신 의상과 현재 실제 장소를 각각 확정해 새 장면을 그려주세요. 원본 생성 설명이나 캐릭터의 직업·초기 컨셉으로 현재 의상과 배경을 되돌리지 마세요. 얼굴·나이·머리·눈과 정체성은 유지하되 현재 장면에 맞게 배경·소품·자세를 새로 구성하고, 의상 변경이 없다면 최근 확정 의상을 유지해주세요. 앞으로 갈 장소나 회상은 현재 장소로 오인하지 마세요." }]));
      const attempt = await beginImageAttempt(scope, kind, body, reference.documentId);
      const response = await requestImage(kind === "illustration" ? "삽화 생성" : "이미지 생성", body, attempt, abort.signal,
        summary => confirm({ title: "바뀐 장면으로 이미지를 만들까요?", description: summary, confirmLabel: "이미지 생성" }));
      if (!response) return null;
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
      const image: CharacterGalleryImage = { id: `${kind}-${crypto.randomUUID()}`, url, title, blob, kind, jobId: response.headers.get("X-Job-Id") ?? undefined, ...(composition ? { composition } : {}), ...(kind === "illustration" && scene ? { scene: { ...scene } } : {}) };
      seedAccountImage(scope, imageAssetKey(image), blob);
      imageRef.current = [...imageRef.current, image];
      setImages(imageRef.current);
      setBackgrounds(current => current[mode] === NO_BACKGROUND ? current : ({ ...current, [mode]: image.id }));
      remember(image);
      attempt.complete();
      window.dispatchEvent(new Event("maite-gallery-committed"));
      return image;
    } catch (failure) {
      if (id === sequence.current) {
        if (failure instanceof Error && failure.message === GENERATION_POLICY_MESSAGE) showPolicyNotice();
        else setError(abort.signal.aborted ? "이미지 생성 시간이 초과되었습니다. 다시 시도해주세요." : failure instanceof Error ? failure.message : "이미지를 생성하지 못했습니다.");
      }
      return null;
    } finally {
      clearTimeout(timeout);
      if (id === sequence.current) { controller.current = null; setJob(undefined); }
    }
  }
  function retainImages(saved: Pick<CharacterGalleryImage, "id" | "scene">[], selected: { chat?: string; story?: string }) {
    const byId = new Map(imageRef.current.map(image => [image.id, image]));
    const scenes = new Map(saved.map(image => [image.id, image.scene]));
    const detached = new Set<string>();
    imageRef.current = saved.flatMap(({id, scene}) => {
      const image = byId.get(id);
      if (!image) return [];
      if (image.scene && !scene && image.jobId) detached.add(image.jobId);
      return [{ ...image, scene }];
    });
    const original = byId.get("original");
    if (original && !scenes.has(original.id)) imageRef.current.unshift(original);
    archiveRef.current = archiveRef.current.map(image => image.jobId && detached.has(image.jobId) ? { ...image, scene: undefined } : image);
    setArchive(archiveRef.current);
    setImages(imageRef.current);
    setBackgrounds(selected);
  }
  return { images, archive, backgrounds, job, error, dismissError: () => setError(""), cancel, clear, clearArchive, registerOriginal, restoreImages, restoreRemoteImages, originalLoaded, selectBackground, retainImages, generate };
}
