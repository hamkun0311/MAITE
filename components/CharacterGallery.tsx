"use client";
import { isNative, saveFile } from "@/lib/platform/native";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, Images } from "lucide-react";
import { CharacterImageViewer } from "./CharacterImage";
import { MAX_GALLERY_IMAGES, type CharacterGalleryImage } from "@/lib/characters/gallery";

export default function CharacterGallery({ images }: { images: CharacterGalleryImage[] }) {
  const [preview, setPreview] = useState<CharacterGalleryImage>();
  useEffect(() => {
    if (preview && !images.some(image => image.id === preview.id)) setPreview(undefined);
  }, [images, preview]);
  return <main className="generated-gallery" aria-label="생성 이미지 갤러리">
    <div className="generated-gallery-heading">
      <h1><Images size={24} aria-hidden="true" /> 갤러리 <span>{images.length}장</span></h1>
      <p>캐릭터, 대화 이미지, 이야기 삽화를 모아보세요.</p>
      <small>최근 {MAX_GALLERY_IMAGES}장 · 현재 탭에서만 보관되며 새로고침하면 사라집니다.</small>
    </div>
    {images.length ? <div className="generated-gallery-grid">
      {images.map(image => <article key={image.id}>
        <button className="gallery-image-trigger" type="button" aria-label={`이미지 보기: ${image.title}`} onClick={() => setPreview(image)}>
          <img src={image.url} alt={image.title} loading="lazy" />
        </button>
        <div className="gallery-image-details">
          <div><h2>{image.title}</h2><p>{image.kind === "character" ? "캐릭터" : image.kind === "outfit" ? "대화 이미지" : "이야기 삽화"}</p></div>
          <a href={image.url} download={`${image.title.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 60) || "maite-image"}.jpg`} onClick={event => { if (isNative()) { event.preventDefault(); void saveFile(image.blob, `${image.title}.jpg`).catch(() => window.alert("이미지를 공유하지 못했습니다.")); } }} aria-label={`다운로드: ${image.title}`} title="이미지 다운로드"><ArrowDownToLine size={20} aria-hidden="true" /></a>
        </div>
      </article>)}
    </div> : <div className="generated-gallery-empty"><Images size={40} aria-hidden="true" /><h2>아직 생성한 이미지가 없어요.</h2><p>이미지를 만들면 이곳에서 다시 볼 수 있어요.</p><Link href="/ideal">캐릭터 생성하기</Link></div>}
    {images.length > 0 && <CharacterImageViewer src={preview?.url ?? images[0].url} title={preview?.title ?? images[0].title} open={!!preview} onClose={() => setPreview(undefined)} />}
  </main>;
}
