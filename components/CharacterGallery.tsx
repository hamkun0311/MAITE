"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Images } from "lucide-react";
import { CharacterImageViewer } from "./CharacterImage";
import { MAX_GALLERY_IMAGES, type CharacterGalleryImage } from "@/lib/characters/gallery";

export default function CharacterGallery({ images, mode, onApply }: { images: CharacterGalleryImage[]; mode?: "chat" | "story"; onApply?: (id: string) => void }) {
  const [preview, setPreview] = useState<CharacterGalleryImage>();
  const [filter, setFilter] = useState<"all" | "outfit" | "illustration">("all");
  const visible = images.filter(image => filter === "all" || image.kind === filter);
  useEffect(() => {
    if (preview && !images.some(image => image.id === preview.id)) setPreview(undefined);
  }, [images, preview]);
  return <main className="generated-gallery" aria-label="생성 이미지 갤러리">
    <div className="generated-gallery-heading">
      {mode && <Link className="native-back" href={`/ideal/${mode}`}>← {mode === "chat" ? "대화로" : "이야기로"} 돌아가기</Link>}
      <h1><Images size={24} aria-hidden="true" /> 갤러리 <span>{images.length}장</span></h1>
      <p>캐릭터, 대화 이미지, 이야기 삽화를 모아보세요.</p>
      <small>최근 {MAX_GALLERY_IMAGES}장 · 현재 탭에서만 보관되며 새로고침하면 사라집니다.</small>
    </div>
    <div className="native-tabs" role="tablist" aria-label="이미지 종류">{([['all','전체'],['outfit','대화 장면'],['illustration','소설 삽화']] as const).map(([value,label]) => <button type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>
    {images.length ? <div className="generated-gallery-grid">
      {visible.map(image => <article key={image.id}>
        <button className="gallery-image-trigger" type="button" aria-label={`이미지 보기: ${image.title}`} onClick={() => setPreview(image)}>
          <img src={image.url} alt={image.title} loading="lazy" />
        </button>
      </article>)}
    </div> : <div className="generated-gallery-empty"><Images size={40} aria-hidden="true" /><h2>아직 생성한 이미지가 없어요.</h2><p>이미지를 만들면 이곳에서 다시 볼 수 있어요.</p><Link href="/ideal">캐릭터 생성하기</Link></div>}
    {images.length > 0 && <CharacterImageViewer src={preview?.url ?? images[0].url} title={preview?.title ?? images[0].title} open={!!preview} onClose={() => setPreview(undefined)} actions={preview && mode && onApply ? <button type="button" onClick={() => { onApply(preview.id); setPreview(undefined); }}>{mode === "chat" ? "대화" : "소설"} 배경으로 적용</button> : undefined}/>}
  </main>;
}
