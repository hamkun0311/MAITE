"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Images, Image as ImageIcon } from "lucide-react";
import { useAccount } from "./AccountProvider";
import Link from "next/link";
import { useActionConfirm } from "./ActionConfirm";
import { accountEnabled } from "@/lib/account/client";
import type { CharacterProfile } from "@/lib/chat/character";
import type { ChatSession } from "@/lib/chat/session";
import LiveChat from "./LiveChat";
import CharacterBackgroundPicker from "./CharacterBackgroundPicker";
import type { CharacterGalleryImage, CharacterImageJob, VisualKind } from "@/lib/characters/gallery";

export default function CharacterExperience({ mode, imageUrl, avatarUrl, backgroundHidden = false, imageDescription, profile, active, onEdit, onBack, session, gallery, backgroundId, onBackground, onGenerateVisual, imageJob, imageError, onCancelImage }: {
  mode: "chat" | "story"; imageUrl: string; avatarUrl?: string; backgroundHidden?: boolean; imageDescription: string; profile: CharacterProfile; active: boolean; onEdit: () => void; onBack: () => void; session?: ChatSession;
  gallery: CharacterGalleryImage[]; backgroundId?: string; onBackground: (id: string) => void;
  onGenerateVisual: (kind: VisualKind, context: string) => Promise<CharacterGalleryImage | null>;
  imageJob?: CharacterImageJob; imageError: string; onCancelImage: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const confirm = useActionConfirm();
  const { account } = useAccount();
  async function generateVisual(kind: VisualKind, context: string) {
    if (accountEnabled() && !await confirm({ title: kind === "illustration" ? "삽화를 그릴까요?" : "대화 장면을 그릴까요?", description: "현재 장면과 인물의 모습으로 이미지를 만들어요.", lines: [{ label: "이미지 생성", value: `${kind === "illustration" ? 50 : 30}하트` }], confirmLabel: "그림 만들기" })) return;
    await onGenerateVisual(kind, context);
    // Generated images stay in the gallery; do not interrupt reading with a viewer.
  }
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (active) heading.current?.focus({ preventScroll: true }); }, [active]);
  const userName = account?.profile?.display_name;
  const character = useMemo(() => ({ ...profile, mode, imageDescription, ...(userName ? { userName } : {}) }), [profile, mode, imageDescription, userName]);
  const readerHeading = <div className="character-screen-heading">
    <button type="button" onClick={onBack} aria-label="캐릭터 이미지로 돌아가기" title="캐릭터 이미지로 돌아가기"><ArrowLeft size={22} aria-hidden="true" /></button>
    {mode === "chat" && avatarUrl && <img className="reader-character-avatar" src={avatarUrl} alt=""/>}
    <div className="character-reader-title"><h2 ref={heading} tabIndex={-1}>{mode === "chat" ? profile.name : "이야기 만들기"}</h2><p>{profile.name} · {profile.age}세</p></div>
    <button className="character-background-button" type="button" aria-label="배경 변경" disabled={!!imageJob} onClick={() => setPickerOpen(true)}><ImageIcon size={17}/>배경</button>
    <Link className="reader-gallery-button" href={`/ideal/gallery?from=${mode}`} aria-label="장면 갤러리"><Images size={17}/>갤러리</Link>
  </div>;
  return <section className={`character-experience character-${mode}-experience${backgroundHidden ? " character-no-background" : ""}`} aria-label={mode === "chat" ? "대화하기" : "이야기 만들기"}>
    {!backgroundHidden && <img className="character-backdrop" src={imageUrl} alt="" />}
    <div className="character-experience-content">
      <LiveChat character={character} active={active} session={session} headingContent={readerHeading} onGenerateVisual={generateVisual} imageJob={imageJob} imageError={imageError} onCancelImage={onCancelImage} />
    </div>
    <CharacterBackgroundPicker open={pickerOpen} images={gallery} selected={backgroundId} onSelect={onBackground} onClose={() => setPickerOpen(false)} />
  </section>;
}
