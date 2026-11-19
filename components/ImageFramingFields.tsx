"use client";
import {useId} from "react";
import {IMAGE_SHOTS,IMAGE_ANGLES,IMAGE_GAZES,type ImageFraming} from "@/lib/characters/framing";

export default function ImageFramingFields({value,onChange,disabled=false,hasPerson=true}:{value:ImageFraming;onChange:(value:ImageFraming)=>void;disabled?:boolean;hasPerson?:boolean}){
 const id=useId();
 return <fieldset className="image-framing-fields" disabled={disabled}><legend>구도 설정</legend>
  <label htmlFor={`${id}-shot`}>촬영 범위<select id={`${id}-shot`} aria-label="촬영 범위" value={value.shot} onChange={event=>onChange({...value,shot:event.target.value as ImageFraming["shot"],...(event.target.value==="face"?{pose:undefined}:{}),...(event.target.value!=="detail"?{focus:undefined}:{gaze:"auto",expression:undefined,pose:undefined})})}>{Object.entries(IMAGE_SHOTS).map(([key,label])=><option key={key} value={key} disabled={!hasPerson&&key!=="auto"&&key!=="detail"}>{label}</option>)}</select></label>
  <label htmlFor={`${id}-angle`}>카메라 각도<select id={`${id}-angle`} aria-label="카메라 각도" value={value.angle} onChange={event=>onChange({...value,angle:event.target.value as ImageFraming["angle"]})}>{Object.entries(IMAGE_ANGLES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  {value.shot==="detail"&&<label htmlFor={`${id}-focus`}>집중 대상<input id={`${id}-focus`} aria-label="집중 대상" value={value.focus||""} maxLength={120} placeholder="예: 눈빛, 손에 든 꽃, 책상 위 편지" onChange={event=>onChange({...value,focus:event.target.value})}/><small>확대해서 보고 싶은 대상을 입력해주세요.</small></label>}
  {hasPerson&&value.shot!=="detail"&&<><label htmlFor={`${id}-gaze`}>시선<select id={`${id}-gaze`} aria-label="시선" value={value.gaze} onChange={event=>onChange({...value,gaze:event.target.value as ImageFraming["gaze"]})}>{Object.entries(IMAGE_GAZES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label htmlFor={`${id}-expression`}>표정 (선택)<input id={`${id}-expression`} aria-label="표정 (선택)" value={value.expression||""} maxLength={120} placeholder="예: 수줍은 미소, 놀란 표정" onChange={event=>onChange({...value,expression:event.target.value})}/></label>
   {value.shot!=="face"&&<label htmlFor={`${id}-pose`}>자세·동작 (선택)<input id={`${id}-pose`} aria-label="자세·동작 (선택)" value={value.pose||""} maxLength={180} placeholder="선택한 범위 안에서 보일 동작" onChange={event=>onChange({...value,pose:event.target.value})}/></label>}</>}
  <small>선택한 범위로 새로 그려요. 비율은 세로 9:16을 유지해요.</small>
 </fieldset>;
}
