import {z} from "zod";

export const IMAGE_SHOTS={auto:"자동",face:"얼굴 클로즈업",bust:"바스트샷",waist:"상반신",full:"전신",detail:"부분 클로즈업"} as const;
export const IMAGE_ANGLES={auto:"자동",front:"정면",threeQuarter:"사선",profile:"옆모습",high:"위에서",low:"아래에서"} as const;
export const IMAGE_GAZES={auto:"자동",viewer:"카메라 보기",away:"다른 곳 보기"} as const;
export const imageFramingSchema=z.object({
 shot:z.enum(["auto","face","bust","waist","full","detail"]),
 angle:z.enum(["auto","front","threeQuarter","profile","high","low"]).default("auto"),
 gaze:z.enum(["auto","viewer","away"]).default("auto"),
 expression:z.string().trim().max(120).optional(),pose:z.string().trim().max(180).optional(),focus:z.string().trim().max(120).optional(),
}).strict().refine(value=>value.shot!=="detail"||!!value.focus,"부분 클로즈업의 집중 대상을 입력해주세요.");
export type ImageFraming=z.infer<typeof imageFramingSchema>;
export const defaultImageFraming=():ImageFraming=>({shot:"auto",angle:"auto",gaze:"auto"});
export const outfitVisible=(framing?:ImageFraming)=>framing?.shot!=="face"&&framing?.shot!=="detail";
const shots={auto:"scene-appropriate shot",face:"tight face close-up, head and at most shoulders; no torso or legs",bust:"bust shot, head to chest; no waist or legs",waist:"waist-up shot; no legs or feet",full:"full-body shot, head to feet",detail:"tight detail close-up of the requested focus only"};
const angles={auto:"scene-appropriate angle",front:"front view",threeQuarter:"three-quarter view",profile:"side profile",high:"high angle looking down",low:"low angle looking up"};
export function requestedCamera(f?:ImageFraming){return f&&(f.shot!=="auto"||f.angle!=="auto")?`${shots[f.shot]}; ${angles[f.angle]}`:undefined;}
export function framingDirection(value?:ImageFraming){
 if(!value)return "";
 const f=imageFramingSchema.parse(value);
 if(f.shot==="auto"&&f.angle==="auto"&&f.gaze==="auto"&&!f.expression&&!f.pose&&!f.focus)return "";
 const details = [
  f.gaze === "viewer" ? "Gaze toward the camera." : f.gaze === "away" ? "Gaze away from the camera." : "",
  f.expression && `Expression: ${f.expression}.`,
  f.pose && f.shot !== "face" && `Pose: ${f.pose}.`,
  f.shot === "detail" && `Focus: ${f.focus}.`,
 ].filter(Boolean).join(" ");
 return `Requested framing: ${shots[f.shot]}; ${angles[f.angle]}. ${details}`.trim();
}
