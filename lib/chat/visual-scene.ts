import { z } from "zod";
import type { ChatMemory } from "./memory.ts";
export const visualSceneSchema = z.object({ location:z.string().max(240).optional(), destination:z.string().max(240).optional(), outfit:z.string().max(240).optional(), turn:z.number().int().min(0).default(0), memoryTurn:z.number().int().min(0).optional() });
export type VisualScene = z.infer<typeof visualSceneSchema>;
const future = /내일|나중에|다음에|언젠가|갈 예정|가기로|가고 싶|(?<!들어)갈까|가볼까|(?<!들어)가자|가야겠|입고 싶|입을까/;
const refusal = /안\s*갈|안\s*가[.!?\s]|가지\s*않|안\s*입|입지\s*않|싫어|아직.*(?:못|안)|여기.*(?:아니|아냐)/;
const place = /(?:[가-힣A-Za-z0-9·]{1,24}\s*)?(?:(?:왕궁|궁전|저택|성|호텔|학교|대성당|신전|병원)(?:의)?\s*(?:연회장|무도회장|정원|침실|객실|복도|회랑|옥상|예배당|응접실|지하실)|떡볶이\s*집|김밥\s*집|국밥\s*집|연회장|무도회장|훈련장|전투장|광장|시장|정원|정자|예배당|대성당|교회|신전|사원|지하실|지하 감옥|감옥|서재|연구실|병실|병원|응접실|대기실|복도|회랑|옥상|다락방|객실|식당|음식점|분식집|레스토랑|카페|서점|도서관|학교|교실|작업실|백화점|매장|가게|공원|왕궁|궁전|성당|침실|거실|주방|부엌|욕실|해변|바닷가|항구|선착장|기차역|골목|마을|설원|사막|동굴|산길|숲속|숲|집)(?=$|[\s.,!?]|에|이|야|은|는|을|를|으로|로|에서|까지|부터)/g;
const garment = /(?:(?:검은|검정|하얀|흰|붉은|빨간|파란|푸른|분홍|노란|초록|회색|베이지|남색|은색|금색|보라색|새하얀|짙은|연한|긴|짧은|실크|비단|면|청|가죽|레이스|프릴|벨벳|줄무늬|꽃무늬|수놓은|금실로|낡은|해진|얇은|두꺼운)\s*)*(?:스포츠\s*브라|돌핀\s*팬츠|sports?\s*bra|dolphin\s*shorts|티셔츠|셔츠|블라우스|원피스|드레스|웨딩드레스|혼례복|예복|연미복|무도회복|제복|사제복|수도복|로브|튜닉|케이프|코트|재킷|자켓|청바지|반바지|바지|치마|스커트|정장|수트|교복|잠옷|파자마|후드|니트|스웨터|가디건|유카타|기모노|한복|도포|저고리|치파오|갑옷|망토|수영복|운동복|유니폼|작업복|목도리|장갑|부츠|운동화|구두)/g;
function sentences(text:string){return text.split(/(?<=[.!?。])\s+|\n/).map(line=>line.trim()).filter(Boolean);}
function places(text:string){
 return sentences(text).filter(line=>!future.test(line)&&!/아니|아냐|않았|아직/.test(line)).flatMap(line=>line.match(place)||[])
  .map(value=>value.trim().replace(/^(?:[가-힣]*(?:은|는|한|던|고)|여기|이곳|우리|같이|함께|일단|지금)\s+/,"")).filter(value=>!/(?:고집|편집|수집|모집|이야기|기억|한적|저녁|공격)$/.test(value));
}
function clothes(text:string){return [...new Set(sentences(text).filter(line=>!future.test(line)&&!/안\s*입|입지\s*않|벗었|벗어|안\s*골/.test(line)).flatMap(line=>line.match(garment)||[]))].join(" · ");}
/** An agreed immediate destination is drawable, but is not proof of arrival. */
export function agreedVisualDestination(user:string,answer:string):string|undefined{
 const deferred=/내일|모레|나중에|다음에|다음엔|언젠가|이따|다음\s*주|주말|예정|만약/;
 if(deferred.test(user+answer)||refusal.test(answer)||/안\s*돼|못\s*가|가지\s*마|가지\s*말|가고\s*싶지/.test(answer)||/혼자|나만|너만/.test(user))return;
 if(!/(?:가볼래|가볼까|갈래|갈까|가자|가보자|이동하자|옮기자)/.test(user)||!/(?:가보자|가자|같이\s*가|함께\s*가|가볼까|가볼게|가요|가죠)/.test(answer))return;
 const cleaned=user.replace(/"[^"\n]*"|'[^'\n]*'|“[^”\n]*”|‘[^’\n]*’/g,"");
 return places(cleaned.replace(/가볼래|가볼까|갈래|갈까|가보자|가자|이동하자|옮기자/g,"")).at(-1)?.slice(0,240);
}
/** Confirmed model facts first, deterministic completed-exchange fallback second. No AI call. */
export function updateVisualScene(previous:VisualScene,user:string,answer:string,memory?:ChatMemory):VisualScene{
 const next:VisualScene={...previous,destination:agreedVisualDestination(user,answer),turn:Math.max(previous.turn+1,memory?.turn??0),...(memory?{memoryTurn:memory.turn}:{})};
 const facts=memory?.facts.filter(f=>f.subjectId==="character"&&f.certainty!=="inferred"&&!/plan|future|promise|wish|request|proposal|예정|요청/.test(f.action))??[];
 const fresh=(f:typeof facts[number])=>!!memory&&memory.turn>(previous.memoryTurn??0)&&Number(f.sourceTurnId.split("_")[1])===memory.turn;
 const locationFact=facts.filter(f=>/^(?:current_)?location$|현재.*장소|현재.*위치/i.test(f.action)&&(fresh(f)||!previous.location)).at(-1);
 const outfitFact=facts.filter(f=>/outfit|cloth|wardrobe|attire|wear|의상|착장/i.test(f.action)&&(fresh(f)||!previous.outfit)).at(-1);
 if(locationFact)next.location=locationFact.value;
 if(outfitFact)next.outfit=outfitFact.value;
 if(refusal.test(answer))return next;
 if(!locationFact){
  const ownArrival=sentences(answer).filter(line=>/도착|들어왔|들어갔|이동했|지금|여기|왔네|왔어|왔지/.test(line)&&!/(?:너|당신|혼자).*(?:도착|갔)/.test(line)).flatMap(line=>places(line)).at(-1);
  const sharedArrival=/(?:여기|이곳|우리|같이|함께)/.test(user)&&/(?:여기|이곳|도착|들어|왔|이야|야\b)/.test(user)&&!/나\s*혼자|나만|나는\s*혼자/.test(user)&&/응|그래|좋아|들어가|맞아|여기|같이|함께|먹|앉/.test(answer)?places(user).at(-1):undefined;
  const candidate=ownArrival||sharedArrival;
  if(candidate)next.location=candidate.slice(0,240);
 }
 if(!outfitFact){
  const ownClothing=sentences(answer).filter(line=>/입|갈아|차림|걸쳤|골랐|정했|착용/.test(line)&&!/(?:너|당신|네|니).*(?:입|차림)/.test(line)).map(clothes).filter(Boolean).at(-1);
  const request=/(?:너|네가|니가|갈아입어|입어줘|입어\s*[.!?]|입을래)/.test(user)&&!/(?:내가|나는|난|나도).*(?:입었|입고|입을)/.test(user)&&/응|그래|좋아|입|갈아|골랐|정했/.test(answer)?clothes(user):undefined;
  if(ownClothing||request)next.outfit=(ownClothing||request)!.slice(0,240);
 }
 return next;
}
export function rebuildVisualScene(messages:{role:"user"|"assistant";content:string;checkinId?:string}[],memory?:ChatMemory):VisualScene{
 let result:VisualScene={turn:0},user="";
 for(const message of messages){if(message.role==="user")user=message.content;else if(user&&!message.checkinId){result=updateVisualScene(result,user,message.content);user="";}}
 const facts=memory?.facts.filter(f=>f.subjectId==="character"&&f.certainty!=="inferred"&&!/plan|future|promise/.test(f.action))??[];
 if(!result.location)result.location=facts.filter(f=>/^(?:current_)?location$/i.test(f.action)).at(-1)?.value;
 if(!result.outfit)result.outfit=facts.filter(f=>/outfit|cloth|attire|wear/i.test(f.action)).at(-1)?.value;
 result.turn=Math.max(result.turn,memory?.turn??0);if(memory)result.memoryTurn=memory.turn;return result;
}
export function visualSceneKeywords(scene:VisualScene){return [scene.location?`장소: ${scene.location}`:undefined,scene.outfit?`의상: ${scene.outfit}`:undefined].filter((text):text is string=>!!text);}
export function sceneAttributes(text:string){return {location:places(text).at(-1),outfit:clothes(text)||undefined};}
