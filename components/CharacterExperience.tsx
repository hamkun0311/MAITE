"use client";
import type { ImageSceneSelection } from "@/lib/characters/visual";
import ImageFramingFields from "./ImageFramingFields";
import {defaultImageFraming,imageFramingSchema,type ImageFraming} from "@/lib/characters/framing";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Images, Image as ImageIcon } from "lucide-react";
import { useAccount } from "./AccountProvider";
import CachedImage from "./CachedImage";
import { imageAssetKey } from "@/lib/platform/image-cache";
import { selectImageScene } from "@/lib/characters/scene-selection";
import { storyConceptsForChapter } from "@/lib/novel/series";
import { userDisplayName } from "@/lib/chat/identity";
import Link from "next/link";
import { useActionConfirm } from "./ActionConfirm";
import { accountEnabled } from "@/lib/account/client";
import type { CharacterProfile } from "@/lib/chat/character";
import type { ChatSession } from "@/lib/chat/session";
import LiveChat from "./LiveChat";
import CharacterBackgroundPicker from "./CharacterBackgroundPicker";
import { CharacterImageViewer } from "./CharacterImage";
import type { CharacterGalleryImage, CharacterImageJob, VisualKind, IllustrationScene } from "@/lib/characters/gallery";

export default function CharacterExperience({ mode, characterDocumentId, rewindToken, imageUrl, avatarUrl, backgroundHidden = false, imageDescription, profile, active, onEdit, onBack, session, gallery, backgroundId, onBackground, onGenerateVisual, imageJob, imageError, onCancelImage, onDismissImageError, onRewindStory }: {
  characterDocumentId?: string; rewindToken?: string; mode: "chat" | "story"; imageUrl: string; avatarUrl?: string; backgroundHidden?: boolean; imageDescription: string; profile: CharacterProfile; active: boolean; onEdit: () => void; onBack: () => void; session?: ChatSession;
  gallery: CharacterGalleryImage[]; backgroundId?: string; onBackground: (id: string) => void;
  onGenerateVisual: (kind: VisualKind, context: string, scene?: IllustrationScene, selection?: ImageSceneSelection) => Promise<CharacterGalleryImage | null>;
  imageJob?: CharacterImageJob; imageError: string; onCancelImage: () => void; onDismissImageError: () => void;
  onRewindStory?: (chapter: number) => Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<CharacterGalleryImage | null>(null);
  const [framing,setFraming]=useState<ImageFraming>(defaultImageFraming);
  useEffect(() => { if (!active) setPickerOpen(false); }, [active]);
  const confirm = useActionConfirm();
  const { account } = useAccount();
  async function generateVisual(kind: VisualKind, context: string, scene?: IllustrationScene, chapter?: number) {
    let selection = selectImageScene(context, { mode, profileName: profile.name,
      userNames: [userDisplayName({ concept: profile.concept, userName: account?.profile?.display_name }, session?.storyState?.seriesConcept), account?.profile?.display_name || "당신"],
      knownNames: [...(session?.chatMemory?.participants.filter(person => person.id !== "user").map(person => person.name) ?? []), ...(session?.storyState?.characters.map(person => person.name) ?? [])],
    });
    if(kind==="illustration")selection={...selection,framing:!selection.target&&framing.shot!=="auto"&&framing.shot!=="detail"?defaultImageFraming():framing};
    if (accountEnabled() && !await confirm({ title: kind === "illustration" ? "삽화를 그릴까요?" : "대화 장면을 그릴까요?", description: "현재 장면과 인물의 모습으로 이미지를 만들어요.", sceneDetails: selection, editableTarget: kind === "illustration", editableFraming: kind === "illustration", onSceneChange:next=>{selection=next;}, imageNotice:true, lines: [{ label: "이미지 생성", value: `${kind === "illustration" ? 50 : 30}하트` }], confirmLabel: "그림 만들기" })) return;
    if(accountEnabled())selection={...selection,location:selection.location?.trim(),outfit:selection.outfit?.trim(),target:selection.target?.trim()||undefined,characters:[...new Set([...selection.characters,...(selection.target?.trim()?[selection.target.trim()]:[])])].slice(-8),confirmed:true};
    if(kind==="illustration"){
      if(!imageFramingSchema.safeParse(selection.framing).success)return;
      setFraming(selection.framing!);
      const castConcepts = storyConceptsForChapter(session?.storyState, chapter ?? scene?.chapter ?? session?.storyState?.chapter ?? 0);
      if (castConcepts.length) selection = {...selection,castConcepts};
    }
    const image = await onGenerateVisual(kind, context, scene, selection);
    if (image) setPreview(image);
  }
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (active) heading.current?.focus({ preventScroll: true }); }, [active]);
  const userName = account?.profile?.display_name;
  const character = useMemo(() => ({ ...profile, mode, imageDescription, ...(userName ? { userName } : {}) }), [profile, mode, imageDescription, userName]);
  const readerHeading = (storyAction: ReactNode) => <div className="character-screen-heading">
    <button type="button" onClick={onBack} aria-label="캐릭터 이미지로 돌아가기" title="캐릭터 이미지로 돌아가기"><ArrowLeft size={22} aria-hidden="true" /></button>
    {mode === "chat" && avatarUrl && <img className="reader-character-avatar" src={avatarUrl} alt=""/>}
    <div className="character-reader-title"><h2 ref={heading} tabIndex={-1}>{mode === "chat" ? profile.name : "이야기 만들기"}</h2><p>{profile.name} · {profile.age}세</p></div>
    {storyAction}
    <button className="character-background-button" type="button" aria-label="배경 변경" disabled={!!imageJob} onClick={() => setPickerOpen(true)}><ImageIcon size={17}/>배경</button>
    <Link className="reader-gallery-button" href={`/ideal/gallery?from=${mode}`} aria-label="장면 갤러리"><Images size={17}/>갤러리</Link>
  </div>;
  return <section className={`character-experience character-${mode}-experience${backgroundHidden ? " character-no-background" : ""}`} aria-label={mode === "chat" ? "대화하기" : "이야기 만들기"}>
    {!backgroundHidden && <CachedImage className="character-backdrop" src={imageUrl} cacheKey={imageAssetKey(gallery.find(image => image.id === backgroundId) || {})} alt="" />}
    <div className="character-experience-content">
      <LiveChat rewindToken={rewindToken} onRewindStory={onRewindStory} characterDocumentId={characterDocumentId} character={character} active={active} session={session} headingContent={readerHeading} imageOptions={mode==="story"&&!accountEnabled()?<details className="image-framing-options"><summary>이미지 구도</summary><ImageFramingFields value={framing} onChange={setFraming} disabled={!!imageJob}/></details>:undefined} onGenerateVisual={generateVisual} imageJob={imageJob} imageError={imageError} onCancelImage={onCancelImage} onDismissImageError={onDismissImageError} />
    </div>
    <CharacterBackgroundPicker open={pickerOpen} images={gallery} selected={backgroundId} onSelect={onBackground} onClose={() => setPickerOpen(false)} />
    {preview && <CharacterImageViewer src={preview.url} title={preview.title} cacheKey={imageAssetKey(preview)} open={active} onClose={() => setPreview(null)} />}
  </section>;
}
