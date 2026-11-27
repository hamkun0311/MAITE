"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, Images } from "lucide-react";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { jsonApi } from "@/lib/platform/commerce";
import { useAccount } from "./AccountProvider";
import CachedImage from "./CachedImage";
import { CharacterImageViewer } from "./CharacterImage";
import { useScreenLoading } from "./ScreenLoading";

type GalleryImage = { id: string; jobId?: string; title: string; url: string; thumbnailUrl?: string };
type Gallery = { kind: "chapter" | "character"; title: string; novelId?: string; images: GalleryImage[]; imageUrl?: string; thumbnailUrl?: string };

export default function PurchasedGallery() {
  const id = usePathname().split("/").at(-1)!;
  const { user } = useAccount();
  return <GalleryPage key={`${user?.id ?? "signed-out"}:${id}`} id={id} signedIn={!!user}/>;
}

function GalleryPage({ id, signedIn }: { id: string; signedIn: boolean }) {
  const [gallery, setGallery] = useState<Gallery>();
  const [preview, setPreview] = useState<GalleryImage>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(signedIn);
  const [attempt, setAttempt] = useState(0);
  useScreenLoading(loading);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    setLoading(true);
    setError("");
    void jsonApi(`/api/store?id=${encodeURIComponent(id)}&gallery=1`).then((data: Gallery) => {
      if (active) setGallery(data);
    }).catch((failure: Error) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, signedIn, attempt]);

  const original = gallery?.imageUrl ? { id: `purchased-original-${id}`, title: "기본 캐릭터 이미지", url: gallery.imageUrl, thumbnailUrl: gallery.thumbnailUrl } : undefined;
  const images = [...(original ? [original] : []), ...(gallery?.images ?? [])];
  const novel = gallery?.kind === "chapter";
  const back = novel ? `/ideal/library/${gallery?.novelId ?? id}?listing=${id}` : "/ideal/library";
  const title = novel ? "소설 갤러리" : gallery ? "캐릭터 갤러리" : "갤러리";

  return <main className="native-page account-page purchased-gallery-page">
    <Link className="native-back native-library-back" href={back}><ChevronLeft size={18}/>{novel ? "소설로 돌아가기" : "서고"}</Link>
    <div className="native-page-title"><div><h1>{title}</h1>{gallery && <p>{gallery.title}</p>}</div><Images size={25}/></div>
    {!signedIn && <p>로그인 후 갤러리를 열 수 있어요.</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></p>}
    {gallery && !images.length && <p>볼 수 있는 이미지가 없어요.</p>}
    {images.length > 0 && <div className="purchased-gallery-grid" role="group" aria-label={title}>
      {images.map((image, index) => <button key={image.id} type="button" aria-label={image === original ? "기본 캐릭터 이미지 전체화면" : `${novel ? "삽화" : "이미지"} ${index + 1 - Number(!!original)} 전체화면`} onClick={() => setPreview(image)}>
        <CachedImage src={image.thumbnailUrl ?? image.url} cacheKey={imageAssetKey(image, image.thumbnailUrl ? "thumbnail" : "original")} fallbackSrc={image.url} alt={image.title} loading="lazy"/>
      </button>)}
    </div>}
    {preview && <CharacterImageViewer src={preview.url} title={preview.title} cacheKey={imageAssetKey(preview)} open onClose={() => setPreview(undefined)}/>}
  </main>;
}
