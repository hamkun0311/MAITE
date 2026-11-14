"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function CharacterImageViewer({ src, title, open, onClose }: { src: string; title: string; open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, [open]);
  return <dialog ref={dialog} className="character-image-dialog" aria-label="캐릭터 이미지 전체화면" onClose={onClose} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <button type="button" className="character-image-close" aria-label="전체화면 닫기" onClick={onClose}><X size={26} aria-hidden="true" /></button>
      <img src={src} alt={`${title} — 전체화면 이미지`} />
    </dialog>;
}

export default function CharacterImage({ src, title }: { src: string; title: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="character-image-trigger" type="button" onClick={() => setOpen(true)} aria-label="캐릭터 이미지 전체화면 보기" title="전체화면 보기">
      <img src={src} alt={`${title} — 생성된 2D 캐릭터 일러스트`} />
    </button>
    <CharacterImageViewer src={src} title={title} open={open} onClose={() => setOpen(false)} />
  </>;
}
