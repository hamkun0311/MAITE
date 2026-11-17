"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { CharacterProfile } from "@/lib/chat/character";
import type { ChatSession } from "@/lib/chat/session";
import LiveChat from "./LiveChat";
import CharacterBackgroundPicker from "./CharacterBackgroundPicker";
import { CharacterImageViewer } from "./CharacterImage";
import type { CharacterGalleryImage, CharacterImageJob, VisualKind } from "@/lib/characters/gallery";

export default function CharacterExperience({ mode, imageUrl, backgroundHidden = false, imageDescription, profile, active, onEdit, onBack, session, gallery, backgroundId, onBackground, onGenerateVisual, imageJob, imageError, onCancelImage }: {
  mode: "chat" | "story"; imageUrl: string; backgroundHidden?: boolean; imageDescription: string; profile: CharacterProfile; active: boolean; onEdit: () => void; onBack: () => void; session?: ChatSession;
  gallery: CharacterGalleryImage[]; backgroundId?: string; onBackground: (id: string) => void;
  onGenerateVisual: (kind: VisualKind, context: string) => Promise<CharacterGalleryImage | null>;
  imageJob?: CharacterImageJob; imageError: string; onCancelImage: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<CharacterGalleryImage>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function generateVisual(kind: VisualKind, context: string) {
    const image = await onGenerateVisual(kind, context);
    if (mounted.current && image) setPreview(image);
  }
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (active) heading.current?.focus({ preventScroll: true }); }, [active]);
  const character = useMemo(() => ({ ...profile, mode, imageDescription }), [profile, mode, imageDescription]);
  const readerHeading = <div className="character-screen-heading">
    <button type="button" onClick={onBack} aria-label="캐릭터 이미지로 돌아가기" title="캐릭터 이미지로 돌아가기"><ArrowLeft size={22} aria-hidden="true" /></button>
    <div className="character-reader-title"><h2 ref={heading} tabIndex={-1}>{mode === "chat" ? "대화하기" : "이야기 만들기"}</h2><p>{profile.name} · {profile.age}세</p></div>
    <button className="character-background-button" type="button" disabled={!!imageJob} onClick={() => setPickerOpen(true)}>배경 변경</button>
    <button className="character-reader-settings" type="button" onClick={onEdit}>캐릭터 설정</button>
  </div>;
  return <section className={`character-experience character-${mode}-experience${backgroundHidden ? " character-no-background" : ""}`} aria-label={mode === "chat" ? "대화하기" : "이야기 만들기"}>
    {!backgroundHidden && <img className="character-backdrop" src={imageUrl} alt="" />}
    <div className="character-experience-content">
      <LiveChat character={character} active={active} session={session} headingContent={readerHeading} onGenerateVisual={generateVisual} imageJob={imageJob} imageError={imageError} onCancelImage={onCancelImage} />
    </div>
    <CharacterBackgroundPicker open={pickerOpen} images={gallery} selected={backgroundId} onSelect={onBackground} onClose={() => setPickerOpen(false)} />
    <CharacterImageViewer src={preview?.url || imageUrl} title={preview?.title || profile.name} open={!!preview} onClose={() => setPreview(undefined)} />
  </section>;
}
