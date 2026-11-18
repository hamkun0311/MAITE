"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import CachedImage from "./CachedImage";

export function CharacterImageViewer({ src, title, open, onClose, actions, cacheKey, onBlob }: { src: string; title: string; open: boolean; onClose: () => void; actions?: ReactNode; cacheKey?: string; onBlob?: (blob: Blob) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, [open]);
  return <dialog ref={dialog} className="character-image-dialog" aria-label="캐릭터 이미지 전체화면" onClose={event => { if (!event.currentTarget.open) onClose(); }} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <button type="button" className="character-image-close" aria-label="전체화면 닫기" onClick={onClose}><X size={26} aria-hidden="true" /></button>
      {open && <CachedImage src={src} cacheKey={cacheKey} onBlob={onBlob} alt={`${title} — 전체화면 이미지`} />}
      {actions && <div className="viewer-actions">{actions}</div>}
    </dialog>;
}

export default function CharacterImage({ src, title, width, height }: { src: string; title: string; width?: number; height?: number }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="character-image-trigger" type="button" onClick={() => setOpen(true)} aria-label="캐릭터 이미지 전체화면 보기" title="전체화면 보기">
      <img src={src} width={width || 720} height={height || 1280} alt={`${title} — 생성된 2D 캐릭터 일러스트`} />
    </button>
    <CharacterImageViewer src={src} title={title} open={open} onClose={() => setOpen(false)} />
  </>;
}
