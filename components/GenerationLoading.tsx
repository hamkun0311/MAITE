"use client";
import { useEffect, useRef } from "react";
import writingArtwork from "./assets/writing-loading.png";

/** Native dialog keeps keyboard focus inside the cancellable generation popup. */
export default function GenerationLoading({ title, detail, onCancel, returnFocusSelector }: {
  title: string; detail: string; onCancel: () => void; returnFocusSelector: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      requestAnimationFrame(() => document.querySelector<HTMLElement>(returnFocusSelector)?.focus({ preventScroll: true }));
    };
  }, [returnFocusSelector]);
  return <dialog ref={dialog} className="generation-loading" aria-labelledby="generation-loading-title" aria-describedby="generation-loading-detail" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="generation-writing" aria-hidden="true"><img src={typeof writingArtwork === "string" ? writingArtwork : writingArtwork.src} alt="" /><span className="generation-writing-dots"><i /><i /><i /></span></div>
    <h2 id="generation-loading-title">{title}</h2>
    <p id="generation-loading-detail" role="status" aria-live="polite">{detail}</p>
    <button type="button" onClick={onCancel}>생성 취소</button>
  </dialog>;
}
