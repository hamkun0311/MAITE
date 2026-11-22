"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ImageSceneSelection } from "@/lib/characters/visual";
import { CircleAlert, Heart, Trash2, X } from "lucide-react";
import { GENERATION_POLICY_MESSAGE } from "@/lib/generation-policy";
import ImageFramingFields from "./ImageFramingFields";
import {defaultImageFraming,imageFramingSchema,outfitVisible} from "@/lib/characters/framing";

type Confirmation = { title: string; description: string; keywords?: string[]; sceneDetails?: ImageSceneSelection; editableTarget?: boolean; editableFraming?: boolean; onSceneChange?: (scene:ImageSceneSelection)=>void; imageNotice?: boolean; lines?: { label: string; value: string }[]; confirmLabel?: string; danger?: boolean; acknowledgeOnly?: boolean };
const Context = createContext<(value: Confirmation) => Promise<boolean>>(async () => false);
export const useActionConfirm = () => useContext(Context);
export function useGenerationPolicyNotice() {
  const show = useActionConfirm();
  return () => void show({ title: GENERATION_POLICY_MESSAGE, description: "입력을 수정한 뒤 다시 시도해주세요.", acknowledgeOnly: true });
}
export default function ActionConfirmProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Confirmation>();
  const resolve = useRef<((result: boolean) => void) | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (value) dialog.current?.showModal(); }, [value]);
  useEffect(() => () => { resolve.current?.(false); }, []);
  function finish(result: boolean) { dialog.current?.close(); setValue(undefined); const done = resolve.current; resolve.current = undefined; done?.(result); }
  async function confirm(next: Confirmation) {
    if (resolve.current) return false;
    return new Promise<boolean>(done => { resolve.current = done; setValue(next); });
  }
  function changeScene(key:"location"|"outfit"|"target",text:string){
    if(!value?.sceneDetails)return;
    const next={...value.sceneDetails,[key]:text,...(key==="target"?{targetConfirmed:true,outfit:undefined}:{})};
    value.onSceneChange?.(next);setValue({...value,sceneDetails:next});
  }
  const sceneIncomplete=!!value?.sceneDetails&&(!value.sceneDetails.location?.trim()||(!!value.sceneDetails.target&&outfitVisible(value.editableFraming?value.sceneDetails.framing:undefined)&&!value.sceneDetails.outfit?.trim())||(value.editableTarget&&value.sceneDetails.targetConfirmed&&!value.sceneDetails.target?.trim())||(value.editableFraming&&!imageFramingSchema.safeParse(value.sceneDetails.framing??defaultImageFraming()).success));
  return <Context.Provider value={confirm}>{children}{value && <dialog ref={dialog} className={`action-confirm${value.danger ? " is-danger" : ""}`} aria-labelledby="action-confirm-title" aria-describedby="action-confirm-description" onCancel={event => { event.preventDefault(); finish(false); }}>
    <div className="sheet-handle"/><button type="button" className="sheet-close" aria-label="확인 팝업 닫기" onClick={() => finish(false)}><X size={20}/></button>
    <div className="confirm-symbol">{value.acknowledgeOnly ? <CircleAlert size={25}/> : value.danger ? <Trash2 size={25}/> : <Heart size={25}/>}</div><h2 id="action-confirm-title">{value.title}</h2><p id="action-confirm-description">{value.description}</p>
    {value.sceneDetails && <section className="confirm-scene-keywords" aria-label="장면 키워드"><h3>장면 키워드</h3><dl className="scene-details-list">
      <div><dt><label htmlFor="scene-location">장소</label></dt><dd><input id="scene-location" aria-label="장면 장소" value={value.sceneDetails.location || ""} maxLength={240} placeholder="예: 왕궁 연회장, 카페 창가" onChange={event=>changeScene("location",event.target.value)}/></dd></div>
      <div><dt><label htmlFor="scene-outfit">의상</label></dt><dd>{value.sceneDetails.target?<input id="scene-outfit" aria-label="장면 의상" value={value.sceneDetails.outfit || ""} maxLength={240} placeholder="예: 흰 블라우스와 검은 치마" onChange={event=>changeScene("outfit",event.target.value)}/>:"해당 없음 (인물 없는 배경)"}</dd></div>
      {value.editableTarget&&<div><dt><label htmlFor="scene-target">대상 인물</label></dt><dd><input id="scene-target" aria-label="삽화 대상 인물" value={value.sceneDetails.target||""} maxLength={80} list="scene-target-suggestions" placeholder="예: 롤랑, 경비대장" onChange={event=>changeScene("target",event.target.value)}/><datalist id="scene-target-suggestions">{value.sceneDetails.characters.map(name=><option key={name} value={name}/>)}</datalist></dd></div>}
      <div><dt>등장인물</dt><dd>{value.sceneDetails.characters.length ? value.sceneDetails.characters.map(name => name === value.sceneDetails?.target ? `${name} (이미지 대상)` : name).join(" · ") : "없음 (배경만 생성)"}</dd></div>
    </dl></section>}
    {value.sceneDetails&&value.editableFraming&&<ImageFramingFields value={value.sceneDetails.framing??defaultImageFraming()} hasPerson={!!value.sceneDetails.target} onChange={framing=>{const next={...value.sceneDetails!,framing};value.onSceneChange?.(next);setValue({...value,sceneDetails:next});}}/>}
    {value.sceneDetails&&<p className="scene-confirm-help">장소와 화면에 보일 의상을 확인해주세요.{!outfitVisible(value.editableFraming?value.sceneDetails.framing:undefined)?" 클로즈업의 의상 입력은 선택이에요.":""}{sceneIncomplete?" 비어 있는 필수 항목을 입력하면 생성할 수 있어요.":""}</p>}
    {value.editableTarget&&<p className="scene-confirm-help">대상 인물을 직접 입력하면 그 인물을 중심으로 그려요. 대상을 바꾸면 해당 인물의 의상을 다시 입력해주세요.</p>}
    {!!value.keywords?.length && <section className="confirm-scene-keywords" aria-label="장면 키워드"><h3>장면 키워드</h3><p>{value.keywords.join(" · ")}</p></section>}
    {value.lines && <dl>{value.lines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl>}
    {value.imageNotice&&<small className="image-generation-notice">부적절한 내용은 AI가 정상적으로 생성하지 않습니다.</small>}
    <div className="confirm-actions">{!value.acknowledgeOnly && <button type="button" onClick={() => finish(false)}>취소</button>}<button type="button" className="native-primary" disabled={sceneIncomplete} onClick={() => finish(true)}>{value.confirmLabel || "확인"}</button></div>
  </dialog>}</Context.Provider>;
}
