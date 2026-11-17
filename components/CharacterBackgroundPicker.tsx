"use client";
import { useEffect, useRef } from "react";
import { X, ImageOff } from "lucide-react";
import { NO_BACKGROUND, type CharacterGalleryImage } from "@/lib/characters/gallery";

export default function CharacterBackgroundPicker({ open, images, selected, onSelect, onClose }: {
  open: boolean; images: CharacterGalleryImage[]; selected?: string; onSelect: (id: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previous; };
  }, [open]);
  return <dialog ref={dialog} className="character-background-picker" aria-label="배경 변경" onClose={onClose} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="background-picker-heading"><div><h2>배경 변경</h2><p>이 캐릭터로 만든 이미지 중 배경을 골라주세요.</p></div><button type="button" aria-label="배경 선택 닫기" onClick={onClose}><X size={22} aria-hidden="true" /></button></div>
    <div className="background-picker-grid">
      <button type="button" aria-label="배경 선택: 배경 없음" aria-pressed={selected === NO_BACKGROUND} onClick={() => { onSelect(NO_BACKGROUND); onClose(); }}>
        <div className="background-none-preview"><ImageOff size={32} aria-hidden="true" /></div><span>배경 없음</span><small>이미지 없이 보기</small>
      </button>
      {images.map(image => <button key={image.id} type="button" aria-label={`배경 선택: ${image.title}`} aria-pressed={selected === image.id} onClick={() => { onSelect(image.id); onClose(); }}>
        <img src={image.url} alt={image.title} /><span>{image.title}</span><small>{image.kind === "character" ? "원본 캐릭터" : image.kind === "illustration" ? "이야기 삽화" : "대화 이미지"}</small>
      </button>)}
    </div>
  </dialog>;
}
