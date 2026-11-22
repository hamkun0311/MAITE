import {storyConceptsForChapter} from "../lib/novel/series.ts";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { generateChapter, novelJsonSchema } from "../lib/novel/generate.ts";
import { createReviewSchema, createMemoryPatchSchema, emptyStoryState, mergeMemory, repeatsPrevious, storyStateSchema } from "../lib/novel/state.ts";
import { z } from "zod";
import { POST } from "../app/api/chat/route.ts";
import { manuscriptSources, resolveSources } from "../lib/novel/sources.ts";
import { seriesArcSchema, seriesSchedule, storyComplete, storyProgress } from "../lib/novel/series.ts";
import { emptyTimeline,advanceTimeline,timelineForChat } from "../lib/chat/timeline.ts";
import {conversationInstructions,emptyChatMemory} from "../lib/chat/memory.ts";
import {novelTimelineContext,sourceContext} from "../lib/novel/context.ts";
import {integratedEpisodeSchema,validateIntegratedEpisode} from "../lib/novel/integrated.ts";
import {novelGenerationMode} from "../lib/ai-model.ts";
import {novelDialogueRules} from "../lib/novel/dialogue.ts";
import {novelWriterQualityInstructions,novelReviewerQualityInstructions,novelIntegratedReviewInstructions} from "../lib/novel/quality.ts";
import {createNovelReviewLogger,novelReviewLogLevel,manuscriptFingerprint,logNovelDocumentSaved} from "../lib/novel/review-log.ts";
import {novelConceptInstructions} from "../lib/novel/concept.ts";
import {openAIImageEndpoint, openAIImageKey, openAIResponsesEndpoint, openAITextKey} from "../lib/openai-endpoint.ts";

test("OpenAI text and image select endpoints and credentials independently", t => {
 const settings = {
  OPENAI_TEXT_PROVIDER:"direct", OPENAI_IMAGE_PROVIDER:"vnai",
  OPENAI_BASE_URL:"https://text-gateway.example/v1", OPENAI_IMAGE_BASE_URL:"",
  OPENAI_API_KEY:"official", OPENAI_TEXT_API_KEY:"gateway-text",
  OPENAI_IMAGE_API_KEY:"gateway-image", OPENAI_IMAGE_DIRECT_API_KEY:"official-image",
 };
 const keys=Object.keys(settings);
 const previous=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
 Object.assign(process.env,settings);
 assert.equal(openAIResponsesEndpoint(),"https://api.openai.com/v1/responses");
 assert.equal(openAITextKey(),"official");
 assert.equal(openAIImageEndpoint("edits"),"https://text-gateway.example/v1/images/edits");
 assert.equal(openAIImageKey(),"gateway-image");
 process.env.OPENAI_TEXT_PROVIDER="vnai";
 delete process.env.OPENAI_BASE_URL;
 process.env.OPENAI_IMAGE_PROVIDER="direct";
 process.env.OPENAI_IMAGE_BASE_URL="https://image-gateway.example/v1";
 assert.equal(openAIResponsesEndpoint(),"https://apikey.vnaipro.app/v1/responses");
 assert.equal(openAITextKey(),"gateway-text");
 assert.equal(openAIImageEndpoint("generations"),"https://api.openai.com/v1/images/generations");
 assert.equal(openAIImageKey(),"official-image");
});

const character = { mode: "story" as const, name: "서하", age: 25, personality: "다정함", concept: "친구와 서점 복구", genre: "막장드라마" as const, imageDescription: "서점의 탐정" };
const prose = "서하는 서랍에서 계약서를 찾았다. 그가 약속한 수리 날짜가 문서에 적혀 있었다. " + "그녀는 친구에게 전화를 걸어 내일 함께 서점을 정리하자고 말했다. 망설이던 친구가 수화기 너머에서 웃었다. " + "둘은 닫힌 서점 문을 열고 먼지 쌓인 책을 창가로 옮겼다. 새로 비워진 진열대 사이로 햇빛이 들어왔다. 오래 미뤄 두었던 일이 드디어 시작되었다. " + "친구가 가져온 달력에 수리 날짜를 표시했다. 내일 아침에는 창문을 닦기로 했다.";
const fact = { text: "계약서를 찾았다", evidence: "서하는 서랍에서 계약서를 찾았다." };
const seriesArc = { endingPromise: "서점을 다시 열고 친구와 함께 운영한다", installments: Array.from({ length: 5 }, (_, index) => ({ chapter: index + 1, goal: `${index + 1}편 목표`, payoff: `${index + 1}편 결과` })) };
const plan = { seriesArc, chapterGoal: "서점 복구를 시작한다", longTermGoal: "함께 서점을 다시 연다", newInformation: "계약서의 날짜", protagonistChoice: "친구를 부른다", costOrConsequence: "함께 정리를 시작한다",
  beats: [1, 2, 3].map(i => ({ goal: `목표${i}`, obstacle: "망설임", action: "정리한다", outcome: "진전" })), endingChange: "서점 문을 열었다", mustNotRepeat: [] };
const review = { pass: true, sceneAudit:{rolesStable:true,speechIntentClear:true,movementsConsistent:true,actionsCoherent:true}, conceptAlignment: { satisfied: true, evidence: fact.evidence, fix: "설정 준수" }, blockingIssues: [], completedBeats: [1, 2, 3], newEvents: [fact], endingChange: { text: "정리가 시작됨", evidence: "오래 미뤄 두었던 일이 드디어 시작되었다." } };
const patch = { summary: "서하가 계약서를 찾아 친구와 서점 정리를 시작했다.", currentSituation: fact,
  newEvents: [fact], resolvedEvents: [fact], openedThreads: [], closedThreads: [], worldFacts: [fact],
  characters: [{ name: "서하", goal: null, knowledge: [fact], relationships: [] }], nextChapterGoal: "창문을 닦는다",sharedChanges:[],dialogueRegisters:[],propChanges:[] };
const unpack = (value: any): any[] => Array.isArray(value)?value:value?.rows?.map((row:any[])=>Object.fromEntries(value.columns.map((name:string,index:number)=>[name,row[index]])))??[];
// Keep unrelated review fixtures above the generation length gate without changing their evidence.
const fullDraft = (text: string) => text.length >= 2000 ? text : text + "\n\n" + "가나다라마바사아자차카타파하".repeat(180);
const response = (value: unknown, init?: RequestInit) => {
  if (value && typeof value === "object" && "pass" in value) value = { memoryPatch: patch, ...value };
  const body = init ? JSON.parse(String(init.body)) : undefined;
  const input = body ? JSON.parse(body.input) : {};
  const cite = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(cite);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, key === "evidence"||(key==="changeEvidence"&&child!==null)
      ? unpack(input.sourceUnits).find((unit: { id: string; text: string }) => typeof child === "string" && unit.text.includes(child))?.id ?? "unknown_source"
      : cite(child)]));
  };
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: typeof value === "string" ? (body && !body.text ? fullDraft(value) : value) : JSON.stringify(init ? cite(value) : value) }] }] });
};

test("review logging levels gate full content, chunk text and never break generation diagnostics",t=>{
 const old=process.env.NOVEL_REVIEW_LOG_LEVEL;t.after(()=>{if(old===undefined)delete process.env.NOVEL_REVIEW_LOG_LEVEL;else process.env.NOVEL_REVIEW_LOG_LEVEL=old;});
 const logs:any[]=[];t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 assert.equal(novelReviewLogLevel("invalid"),"off");assert.equal(novelReviewLogLevel(" FULL "),"full");
 const traceId="11111111-1111-4111-8111-111111111111",secret="PRIVATE_MANUSCRIPT_".repeat(200);
 process.env.NOVEL_REVIEW_LOG_LEVEL="summary";createNovelReviewLogger({traceId,chapter:2}).event("draft",manuscriptFingerprint(secret),{prose:secret});
 assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_MANUSCRIPT/);
 process.env.NOVEL_REVIEW_LOG_LEVEL="off";createNovelReviewLogger({traceId}).event("draft",{}, {prose:secret});assert.equal(logs.length,1);
 process.env.NOVEL_REVIEW_LOG_LEVEL="full";createNovelReviewLogger({traceId,chapter:2}).event("draft",{attempt:1},{prose:secret});
 const parts=logs.filter(row=>row.event==="content");assert.ok(parts.length>1);assert.equal(parts.map(row=>row.text).join(""),secret);
 assert.ok(parts.every((row,i)=>row.part===i+1&&row.parts===parts.length&&row.traceId===traceId&&!row.truncated));
 assert.equal(new Set(parts.map(row=>row.contentId)).size,1);
 logNovelDocumentSaved({story:{lastJobId:traceId,storyState:{chapter:2,previousProse:secret}}},"doc","chapter");
 assert.equal(logs.at(-1).event,"document_saved");assert.equal(logs.at(-1).proseHash,manuscriptFingerprint(secret).proseHash);
 const count=logs.length;logNovelDocumentSaved({story:{lastJobId:"invalid"}},"doc","chapter");assert.equal(logs.length,count);
 t.mock.method(console,"info",()=>{throw new Error("sink unavailable");});assert.doesNotThrow(()=>createNovelReviewLogger().event("failed"));
});

test("review traces link initial prose, failed verdict, rewrite, accepted output and usage without extra AI calls",async t=>{
 const old=process.env.NOVEL_REVIEW_LOG_LEVEL;process.env.NOVEL_REVIEW_LOG_LEVEL="full";
 t.after(()=>{if(old===undefined)delete process.env.NOVEL_REVIEW_LOG_LEVEL;else process.env.NOVEL_REVIEW_LOG_LEVEL=old;});
 const logs:any[]=[];t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 const traceId="11111111-1111-4111-8111-111111111111",repaired=prose.replace("서랍에서 계약서를 찾았다","책상에서 계약서를 찾았다"),evidence="서하는 책상에서 계약서를 찾았다.";
 const accepted={...review,newEvents:[{text:"계약서 발견",evidence}],conceptAlignment:{satisfied:true,evidence,fix:"설정 유지"}};
 const rejected={...review,pass:false,blockingIssues:[{type:"language",evidence:fact.evidence,fix:"계약서가 놓인 위치를 명료하게 하라"}],memoryPatch:null};
 // The accepted patch must cite the repaired manuscript.
 const acceptedPatch=JSON.parse(JSON.stringify(patch).replaceAll(fact.evidence,evidence));
 const values=[prose,rejected,repaired,{...accepted,memoryPatch:acceptedPatch}];let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{calls++;return response(values.shift(),init);});
 const result=await generateChapter({traceId,character,state:{...emptyStoryState(),chapter:2,seriesArc},direction:"다음",key:"DO_NOT_LOG_API_KEY",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,4);assert.equal(result.text,fullDraft(repaired));assert.ok(logs.every(row=>row.traceId===traceId&&row.chapter===3));
 assert.deepEqual(logs.filter(row=>row.event==="review_decision").map(row=>row.accepted),[false,true]);
 assert.equal(logs.filter(row=>row.event==="rewrite_requested").length,1);
 assert.equal(logs.filter(row=>row.event==="model_call_finished").length,4);
 assert.ok(logs.some(row=>row.event==="review"&&row.blockingIssues?.[0]?.fix.includes("명료")));
 const done=logs.find(row=>row.event==="completed");assert.equal(done.source,"rewrite");assert.equal(done.attempt,2);assert.equal(done.proseHash,manuscriptFingerprint(result.text).proseHash);
 assert.doesNotMatch(JSON.stringify(logs),/DO_NOT_LOG_API_KEY|Authorization/);
});

test("novel HTTP failures trace Gemini and OpenAI codes without the upstream error message", async t => {
 const keys=["NOVEL_REVIEW_LOG_LEVEL","GEMINI_NOVEL_WRITE_MODEL","GEMINI_API_KEY","OPENAI_NOVEL_GENERATION_MODE"] as const;
 const previous=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
 process.env.NOVEL_REVIEW_LOG_LEVEL="summary";
 process.env.OPENAI_NOVEL_GENERATION_MODE="reviewed";
 process.env.GEMINI_API_KEY="fixture";
 const logs: Record<string, unknown>[]=[];
 t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 const cases=[
  {provider:"gemini",model:"gemini-3.5-flash-lite",status:429,body:{error:{code:429,status:"RESOURCE_EXHAUSTED",message:"PRIVATE_ERROR_BODY"}},code:429,errorStatus:"RESOURCE_EXHAUSTED"},
  {provider:"openai",model:"",status:429,body:{error:{code:"insufficient_quota",message:"PRIVATE_ERROR_BODY"}},code:"insufficient_quota",errorStatus:null},
  {provider:"gemini",model:"gemini-3.5-flash-lite",status:503,body:null,code:null,errorStatus:null},
 ];
 let current=cases[0];
 t.mock.method(globalThis,"fetch",async(url:string)=>{
  assert.equal(url.includes("generativelanguage.googleapis.com"),current.provider==="gemini");
  return current.body ? Response.json(current.body,{status:current.status}) : new Response("PRIVATE_ERROR_BODY",{status:current.status});
 });
 const traceId="11111111-1111-4111-8111-111111111111";
 const options={traceId,character,state:{...emptyStoryState(),chapter:1,seriesArc},direction:"다음",key:"fixture",signal:new AbortController().signal,phase:()=>{}};
 for(const item of cases){
  current=item;
  process.env.GEMINI_NOVEL_WRITE_MODEL=item.model;
  await assert.rejects(generateChapter(options),/Novel upstream failed/);
  const failure=logs.at(-1);
  assert.equal(failure?.traceId,traceId);
  assert.equal(failure?.stage,"writing");
  assert.equal(failure?.event,"failed");
  assert.equal(failure?.provider,item.provider);
  assert.equal(failure?.httpStatus,item.status);
  assert.equal(failure?.providerErrorCode,item.code);
  assert.equal(failure?.providerErrorStatus,item.errorStatus);
 }
 assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_ERROR_BODY/);
});

test("summary failures record a safe reason and never publish rejected prose as completed",async t=>{
 const old=process.env.NOVEL_REVIEW_LOG_LEVEL;process.env.NOVEL_REVIEW_LOG_LEVEL="summary";
 t.after(()=>{if(old===undefined)delete process.env.NOVEL_REVIEW_LOG_LEVEL;else process.env.NOVEL_REVIEW_LOG_LEVEL=old;});
 const logs:any[]=[];t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 t.mock.method(globalThis,"fetch",async()=>{throw new Error("SECRET_PROVIDER_OR_KEY");});
 await assert.rejects(generateChapter({character,state:{...emptyStoryState(),chapter:2,seriesArc},direction:"다음",key:"PRIVATE_KEY",signal:new AbortController().signal,phase:()=>{}}),/SECRET_PROVIDER/);
 assert.equal(logs.at(-1).event,"failed");assert.equal(logs.at(-1).reason,"generation_failed");assert.ok(!logs.some(row=>row.event==="completed"||row.event==="content"));
 assert.doesNotMatch(JSON.stringify(logs),/SECRET_PROVIDER_OR_KEY|PRIVATE_KEY/);
});

test("sparse concept direction is bounded, respects explicit preferences and does not add adult content to ambiguous ages",async()=>{
 const writer=await novelWriterQualityInstructions();
 assert.ok(novelConceptInstructions.length<=1300);
 assert.ok(writer.length+novelConceptInstructions.length<=4900);
 assert.ok(novelReviewerQualityInstructions.length+novelConceptInstructions.length<=5300);
 assert.ok(writer.length+novelIntegratedReviewInstructions.length+novelConceptInstructions.length<=6200);
 assert.match(novelConceptInstructions,/actual mutual encounters/);assert.match(novelConceptInstructions,/Explicit user facts, tone limits and endings outrank/);
 assert.match(novelConceptInstructions,/Default to strong, grounded conflict\/reversals/);
 assert.match(novelConceptInstructions,/not new user requirements or automatic review failures/);
 assert.match(novelConceptInstructions,/do not force romance or infidelity/);assert.match(novelConceptInstructions,/gentle\/no-romance\/no-tragedy/);
 assert.match(novelConceptInstructions,/Never age up minors or sexualize unclear ages/);assert.match(novelConceptInstructions,/without explicit sexual acts or anatomy/);
});

test("rough seeds reach planning, writing and review once each with unchanged calls, schemas and user facts",async t=>{
 const concepts=["왕비와 소꿉친구 기사의 비밀 연애", "가족에게 배신당한 후계자", "로맨스 없이 편안하게 서점을 고치는 친구들", "16세 친구들의 학교 축제"];
 for(const concept of concepts){
  const values=[plan,prose,review];let calls=0;
  const context={...character,age:concept.includes("16세")?16:25,concept};
  t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
   calls++;const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
   assert.equal(body.instructions.split("CONCEPT-LED DRAMA:").length-1,1);
   const data=typeof input.context==="string"?JSON.parse(input.context):input.context??input;
   if(data.character)assert.equal(data.character.concept,concept);else assert.ok(body.instructions.includes(concept));
   if(body.text?.format?.name==="chapter_plan"){
    assert.match(body.instructions,/existing goal\/payoff\/beat fields/);
    assert.ok(!("conceptBrief" in body.text.format.schema.properties));
   }
   return response(values.shift(),init);
  });
  const result=await generateChapter({character:context,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
  assert.equal(calls,3);assert.equal(result.state.chapter,1);assert.equal(result.text,fullDraft(prose));
 }
});

test("novel registers persist by speaker and addressee without forcing reciprocal speakers to match",()=>{
 const first={speaker:"햄군",addressee:"지호",style:"polite" as const,evidence:fact.evidence,changeEvidence:null};
 const second={speaker:"지호",addressee:"햄군",style:"casual" as const,evidence:fact.evidence,changeEvidence:null};
 const state=mergeMemory(emptyStoryState(),{...patch,dialogueRegisters:[first,second]},prose,"서점");
 assert.deepEqual(state.dialogueRegisters?.map(p=>p.style),["polite","casual"]);
 const later=mergeMemory(state,{...patch,dialogueRegisters:[]},prose,"서점");assert.deepEqual(later.dialogueRegisters,state.dialogueRegisters);
 assert.throws(()=>mergeMemory(later,{...patch,dialogueRegisters:[{...first,style:"casual"}]},prose,"서점"),/Unsupported dialogue register/);
 const changed=mergeMemory(later,{...patch,dialogueRegisters:[{...first,style:"casual",changeEvidence:"우리 이제 말 놓자."}]},prose+" 우리 이제 말 놓자.","서점");
 assert.equal(changed.dialogueRegisters?.length,2);assert.equal(changed.dialogueRegisters?.find(p=>p.speaker==="지호")?.style,"casual");
 assert.throws(()=>mergeMemory(state,{...patch,dialogueRegisters:[{...first,evidence:"원고에 없는 말투 전환"}]},prose,"서점"),/Unsupported memory/);
 assert.equal(storyStateSchema.safeParse({...state,dialogueRegisters:[{...first,style:"unknown"}]}).success,false);
 assert.match(novelDialogueRules,/actual addressee/);
 assert.match(novelDialogueRules,/even without a stored entry/);
 const sources=manuscriptSources(prose);
 assert.deepEqual(resolveSources({changeEvidence:sources[0].id,unchanged:{changeEvidence:null}},sources),{changeEvidence:sources[0].text,unchanged:{changeEvidence:null}});
 assert.throws(()=>resolveSources({changeEvidence:"missing_source"},sources),/Invalid manuscript source/);
});

test("grounded dialogue and Korean language problems trigger one bounded novel correction",async t=>{
 const bad="치카코가 말했다. “네가 내 문자엔 안 늦게 보잖아.”\n"+prose;
 const repaired=bad.replace("네가 내 문자엔 안 늦게 보잖아","내 문자는 바로 확인하잖아");
 for(const type of ["dialogue","language"]){
  const failed={...review,pass:false,blockingIssues:[{type,evidence:"네가 내 문자엔 안 늦게 보잖아.",fix:"대사의 의도가 명료한 자연스러운 한국어로 수정"}],memoryPatch:null};
  const values=[plan,bad,failed,repaired,review];let calls=0;
  t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
   calls++;const body=JSON.parse(String(init?.body));
   if(!body.text?.format){assert.match(body.instructions,/KOREAN DIALOGUE QUALITY/);assert.doesNotMatch(body.instructions,/only direct dialogue is visible/);}
   if(body.text?.format.name==="chapter_review")assert.match(body.instructions,/REGISTER MEMORY/);
   return response(values.shift(),init);
  });
  const result=await generateChapter({character,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
  assert.equal(calls,5);assert.equal(result.state.chapter,1);assert.match(result.text,/내 문자는 바로 확인하잖아/);
  assert.doesNotMatch(result.text,/문자엔 안 늦게/);
 }
});

test("per-chapter scene review uses the previous chapter and repairs grounded role/deixis errors without changing history",async t=>{
 const previous="햄군은 다리에 깁스를 한 채 입원 중이었다. 간호사 하루가 침대 곁 의자에 앉았다. 하루는 짧은 면회를 마치고 병실 밖으로 나갔다.";
 const prior={...emptyStoryState(),chapter:1,previousProse:previous,previousEnding:previous,summary:"햄군은 입원 환자이고 하루는 그를 찾아오는 간호사다.",worldFacts:["햄군은 입원 환자다","하루는 간호사다"],seriesArc};
 const before=structuredClone(prior);
 const event="하루는 동료에게 차트를 여기로 가져다 달라고 요청했다.";
 const evidence={text:"하루가 차트를 병실에서 확인하기로 했다",evidence:event};
 const accepted={...review,conceptAlignment:{satisfied:true,evidence:event,fix:"인물 역할 유지"},newEvents:[evidence],endingChange:evidence,memoryPatch:{...patch,summary:"하루가 병실에서 차트를 확인하며 업무와 사적인 시간을 구분했다.",currentSituation:evidence,newEvents:[evidence],resolvedEvents:[],worldFacts:[],characters:[]}};
 const cases=[
  {type:"dialogue",bad:"하루는 복도에서 부르는 동료에게 말했다. “금방 올게요.”",good:"하루는 복도에서 부르는 동료에게 말했다. “금방 갈게요.”"},
  {type:"dialogue",bad:"하루가 입원 중인 햄군에게 물었다. “내일도 올 거지?”",good:"하루가 입원 중인 햄군에게 물었다. “내일도 잠깐 들러도 돼?”"},
  {type:"continuity",bad:"하루는 자신이 입원한 병실이라고 설명했다.",good:"하루는 햄군이 입원한 병실이라고 설명했다."},
 ];
 for(const item of cases){
  const start="다음 날 저녁 하루가 햄군의 병실에 들어왔다. 햄군은 침대에 등을 기대고 그녀의 이야기를 들었다. 복도에 서 있던 동료가 차트 확인을 부탁하자 하루는 커튼 쪽으로 고개를 돌렸다. ";
  const end=`\n${event} 햄군은 차트를 읽는 동안 기다리겠다고 했다. 하루는 이번에는 자신의 시간을 지키겠다며 분명하게 답했다. 동료도 고개를 끄덕였고, 둘은 필요한 확인을 마친 뒤 대화를 이어갈 수 있었다.`;
  const draft=start+item.bad+end,repaired=start+item.good+end;
  const faultyQuote=item.bad.includes("“")?item.bad.slice(item.bad.indexOf("“")+1,item.bad.indexOf("”")):item.bad;
  const failed={...accepted,pass:false,blockingIssues:[{type:item.type,evidence:faultyQuote,fix:item.good}],memoryPatch:null};
  const values=[draft,failed,repaired,accepted];let calls=0;
  t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
   calls++;const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
   if(body.text?.format?.name==="chapter_review"){
    assert.equal(input.previousProse,previous);assert.match(body.instructions,/SCENE AUDIT/);assert.match(body.instructions,/speechIntentClear/);
    assert.match(body.instructions,/Earlier mistaken wording/);
   }else{
    assert.match(body.instructions,/NOVEL QUALITY PRINCIPLES/);
    if(calls===3){assert.deepEqual(input.corrections&&JSON.parse(input.corrections).issues.map((issue:any)=>issue.fix),[item.good]);}
   }
   return response(values.shift(),init);
  });
  const result=await generateChapter({character:{...character,name:"하루",concept:"햄군은 입원 환자이고 하루는 소꿉친구 간호사다."},state:prior,direction:"두 번째 이야기",key:"test",signal:new AbortController().signal,phase:()=>{}});
  assert.equal(calls,4);assert.equal(result.state.chapter,2);assert.equal(result.expectedChapter,1);
  assert.equal(result.text,fullDraft(repaired));assert.equal(result.state.previousProse,fullDraft(repaired));assert.deepEqual(prior,before);
  assert.doesNotMatch(result.state.summary,/자신이 입원/);
 }
});

test("all genres require explicit scene audit and repair only evidence-backed intent/action errors",async t=>{
 const cases=[
  {genre:"모험",flag:"speechIntentClear",type:"dialogue",context:"담당 관리가 루루의 지원서를 보고 직접 말했다.",bad:"너 같은 초보가 벌써 지원하겠다고?",good:"“너 같은 초보가 벌써 지원하겠다고?”"},
  {genre:"학원극",flag:"speechIntentClear",type:"dialogue",context:"태오는 선생님께 존댓말로 증언했다. 이어 친구 준호가 태오에게만 작게 물었다. 둘은 평소 반말로 이야기한다.",bad:"태오는 준호에게 몸을 돌려 “선생님이 혼자 곤란해지는 게 보기 싫어서요”라고 답했다.",good:"태오는 준호에게 몸을 돌려 “선생님 혼자 곤란해지는 게 보기 싫었어”라고 답했다."},
  {genre:"직장극",flag:"speechIntentClear",type:"dialogue",context:"팀장은 지민에게 자기 실수만 책임지면 되고 동료의 실수까지 떠안을 필요는 없다고 말했다.",bad:"“네 실수를 심각하게 받아들이라는 뜻은 아니야.”",good:"“네 실수는 바로잡되 다른 사람 몫까지 책임질 필요는 없어.”"},
  {genre:"일상극",flag:"actionsCoherent",type:"causality",context:"동아리에서 신청서를 잃어버려 제출 경로를 찾아야 했다.",bad:"“신청서를 잃어버린 이유를 찾으려면 다 같이 창문부터 닦아요.”",good:"“먼저 신청서를 마지막으로 받은 사람부터 확인해요.”"},
  {genre:"학원극",flag:"speechIntentClear",type:"language",context:"수현과 태오는 이미 복도에 서 있었고 다른 학생들은 계단 앞에서 기다렸다.",bad:"“지금 나가면 누가 이 반을 흔들려고 했는지, 당신이 도구가 됩니다.”",good:"“태오야, 저 애들 따라가면 네가 먼저 수업을 박차고 나간 것처럼 보일 수 있어.”"},
  {genre:"직장극",flag:"rolesStable",type:"continuity",context:"지수는 동료가 회의실을 나가며 고개를 끄덕이는 모습만 보았다.",bad:"지수는 그 고갯짓만으로 동료가 자신을 해고할 서류를 준비했다는 사실을 알아냈다.",good:"지수는 동료가 자기 쪽을 본 것이 마음에 걸렸지만 그 뜻은 알 수 없었다."},
  {genre:"우정극",flag:"actionsCoherent",type:"causality",context:"친구가 내일 다시 올지 묻자 민아는 반드시 오겠다고 답했다.",bad:"“다음엔 혼자 안 남겠습니다”라는 메모를 보고 민아는 친구가 내일 오겠다는 답장을 했음을 알았다.",good:"“내일은 나도 기다리고 있을게”라는 메모를 보고 민아는 웃었다."},
  {genre:"학원극",flag:"speechIntentClear",type:"language",context:"수현은 새 담임으로서 수업과 학생 모두 포기하지 않겠다고 말하려 했다.",bad:"“이 교실에서 제가 포기하는 건 수업이 아니라 여러분이 아닙니다.”",good:"“저는 수업도, 여러분도 포기할 생각 없습니다.”"},
  {genre:"동료극",flag:"speechIntentClear",type:"dialogue",context:"민서는 준호가 와서 기쁘고 혼자 있을 때 심심했다고 말하려 했다.",bad:"“기다렸어, 네가 오면 심심하거든.”",good:"“기다렸어. 네가 없으면 심심하거든.”"},
  {genre:"회사",flag:"speechIntentClear",type:"dialogue",context:"퇴근 시간이 지난 사무실에서 수진은 민호에게 남아 있어도 되는지 허락을 구하려 했다.",bad:"수진은 민호에게 하는 질문을 자신만의 혼잣말이라고 설명했다.",good:"수진은 민호를 바라보며 남아 있어도 괜찮은지 물었다."},
  {genre:"판타지",flag:"rolesStable",type:"continuity",context:"리오는 숲속 오두막의 주인이었고, 에단은 처음 방문한 여행자였다.",bad:"집주인 에단이 손님 리오에게 다음 방문을 약속했다.",good:"여행자 에단이 집주인 리오에게 다음 방문을 약속했다."},
  {genre:"추리",flag:"actionsCoherent",type:"language",context:"탐정과 의뢰인은 넓은 책상을 사이에 두고 마주 앉아 계약서를 확인했다.",bad:"탐정은 두 손을 계속 주머니에 넣은 채 손으로 계약서를 건넸다.",good:"탐정은 주머니에서 손을 꺼내 의뢰인 쪽으로 계약서를 내밀었다."},
  {genre:"여행",flag:"movementsConsistent",type:"continuity",context:"두 친구는 기차역 대합실의 긴 의자에 앉아 다음 날 출발 시간을 의논했다.",bad:"계속 의자에 앉아 있던 친구가 역 밖에서 돌아왔다.",good:"계속 의자에 앉아 있던 친구가 벽에 걸린 시계를 올려다봤다."},
  {genre:"로맨스",flag:"speechIntentClear",type:"dialogue",context:"서하는 민수를 아끼며 자기 편이라고 믿었다. 그녀는 두 마음이 모두 진심이라고 말하려 했다.",bad:"“아끼는 사람 아니고, 내 편이야.”",good:"“내가 아끼는 사람이고, 내 편이야.”"},
  {genre:"일상",flag:"rolesStable",type:"continuity",context:"수현은 다리가 아팠지만 지민은 건강했다. 지민은 수현의 상태를 걱정하며 말을 건넸다.",bad:"“내 다리도 아픈데, 네가 내 마음까지 떨리게 했어.”",good:"“네 다리도 아픈데 여기까지 와서 힘이 돼 줄 줄은 몰랐어.”"},
  {genre:"우정",flag:"actionsCoherent",type:"causality",context:"친구는 상대가 원하면 언제든 손을 놓을 수 있게 가볍게 위로하려 했다.",bad:"상대가 언제든 손을 뺄 수 있도록 빠져나갈 틈 없이 강하게 붙잡았다.",good:"상대가 원하면 놓을 수 있도록 손을 가볍게 받쳐 주었다."},
  {genre:"모험",flag:"rolesStable",type:"continuity",context:"원정대는 모두 살아 돌아왔고 부상자는 세 명이었다. 동료들이 납치되거나 사망한 일은 없었다.",bad:"대장은 끌려가 죽은 동료들의 복수를 선언했다.",good:"대장은 부상당한 동료들을 먼저 치료하겠다고 말했다."},
  {genre:"전투",flag:"rolesStable",type:"continuity",context:"궁수 세 명을 상대로 레아와 동료 호위가 싸우고 있었다. 레아가 첫 궁수 한 명을 제압했다.",bad:"레아는 곧바로 마지막 궁수에게 달려들었다.",good:"동료 호위가 다른 궁수를 제압하자 레아는 남은 궁수에게 달려들었다."},
  {genre:"활극",flag:"actionsCoherent",type:"causality",context:"레아의 무기는 허리에 찬 단검뿐이었다. 상대를 공격할 특별한 마법은 없었다.",bad:"레아는 아무 무기도 꺼내지 않은 채 검으로 상대의 급소를 꿰뚫었다.",good:"레아는 허리의 단검을 뽑아 상대의 팔을 공격했다."},
  {genre:"가족극",flag:"speechIntentClear",type:"language",context:"딸은 공연을 성공시켰지만 외국에 있는 아버지가 자신을 자랑스러워할지 확신하지 못했다.",bad:"아버지가 없는 빈 창밖에 그의 얼굴이 없다는 사실만 더 선명했다.",good:"공연이 끝나도 아버지에게 인정받을 수 있을지는 알 수 없었다."},
  {genre:"모험 로맨스",flag:"actionsCoherent",type:"causality",context:"지휘관은 침입자를 막기 위해 전장에 오고 있었다. 레아는 그를 보고 싶었지만 그가 다칠까 두려웠다.",bad:"지휘관은 단순한 점검을 위해 올 뿐이라 위험은 없다고 레아는 확신했다.",good:"레아는 그를 만날 기대와 전투에 대한 걱정 속에서 부상자들을 대피시키려 움직였다."},
  {genre:"관계 추리",flag:"rolesStable",type:"continuity",context:"동료는 위험에 처한 사람을 모두 보호하라는 임무를 수행했다. 레아는 동료의 속마음을 알지 못했다.",bad:"한 번 공격을 막아 준 행동만으로 레아는 그의 숨겨 온 사랑을 사실로 확인했다.",good:"레아는 자신을 걱정한 것인지 궁금했지만 임무 때문일 수도 있다고 생각했다."},
  {genre:"궁정극",flag:"movementsConsistent",type:"continuity",context:"엘리는 경비가 지키는 회랑 입구에 멈췄다. 창가는 경비 뒤편에 있었고 엘리는 그곳에 접근하지 않았다.",bad:"엘리는 이미 서 있던 창가 아래에서 빠져나와 숨었다.",good:"엘리는 입구의 기둥 뒤로 몸을 숨겼다."},
  {genre:"첩보",flag:"actionsCoherent",type:"causality",context:"동료가 경비에게 서류를 보여 시선만 돌렸다. 경비는 문 앞에 그대로 있었고 수색을 계속했다.",bad:"시선이 잠깐 돌아간 것만으로 수색은 끝났고 모두 안전해졌다.",good:"수색은 계속됐지만 그 짧은 틈에 동료는 열린 문 안으로 몸을 숨겼다."},
  {genre:"잠입",flag:"movementsConsistent",type:"continuity",context:"추격자가 닫힌 문 바로 앞을 지키고 있었다. 두 친구는 문 안에 숨었고 소리가 새면 들킬 상황이었다.",bad:"둘은 문을 사이에 두고 큰 소리로 탈출 계획을 나눴지만 추격자는 듣지 못했다.",good:"둘은 추격자의 발소리가 멀어질 때까지 기다린 뒤 귓가에 탈출 계획을 속삭였다."},
  {genre:"범죄극",flag:"actionsCoherent",type:"causality",context:"형사는 책상 위에 놓인 붉은 봉투를 찾고 있었다. 두 사람은 봉투를 치우지 않았고 형사는 책상을 끝까지 살폈다.",bad:"책상 위의 봉투는 그대로였지만 형사는 아무것도 찾지 못했다.",good:"형사는 책상 위의 붉은 봉투를 발견했다."},
  {genre:"일상 미스터리",flag:"movementsConsistent",type:"continuity",context:"같은 저녁의 대화 중 두 사람은 아직 문 앞에 서 있었다. 다음 만남은 며칠 뒤로 약속했다.",bad:"며칠 뒤 재회했는데도 시간 전환 없이 같은 저녁의 대화가 중단 없이 이어지고 있었다.",good:"며칠 뒤 재회했을 때 두 사람은 그날 문 앞에서 나눈 대화를 떠올렸다."},
 ];
 const event="두 사람은 내일의 일정을 함께 정했다.",fact={text:"내일 일정을 정했다",evidence:event};
 const tail=" 상대는 잠시 생각한 뒤 자신의 계획을 차분히 설명했다. 둘은 서로의 사정을 듣고 약속 시간을 조정했다. 무작정 오래 붙잡는 대신 다음에 다시 만날 시간을 확정하자 이야기는 한결 편안해졌다. 결정을 마친 두 사람은 남은 일을 정리하며 각자의 준비를 시작했다.";
 for(const item of cases){
  const audit={...review.sceneAudit,[item.flag]:false};
  const old={...emptyStoryState(),chapter:2,seriesArc,summary:item.context,previousProse:item.context,previousEnding:item.context},before=structuredClone(old);
  const bad=`${item.context}\n${item.bad}\n${event}${tail}`,good=bad.replace(item.bad,item.good);
  const accepted={...review,newEvents:[fact],endingChange:fact,conceptAlignment:{satisfied:true,evidence:event,fix:"설정 유지"},memoryPatch:{...patch,summary:event,currentSituation:fact,newEvents:[fact],resolvedEvents:[],worldFacts:[],characters:[]}};
  // A positive overall verdict must not override a failed scene check.
  const failed={...accepted,pass:true,sceneAudit:audit,blockingIssues:[{type:item.type,evidence:item.bad,fix:item.good}],memoryPatch:null};
  const values=[bad,failed,good,accepted];let calls=0;
  t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
   calls++;const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
   if(body.text?.format?.name==="chapter_review"){
    assert.ok(body.text.format.schema.required.includes("sceneAudit"));assert.equal(input.previousProse,item.context);
    assert.doesNotMatch(body.instructions,/# 집필 스타일/);
    assert.match(body.instructions,/closing exchange/);assert.match(body.instructions,/All four must be true/);
    assert.match(body.instructions,/REGISTER MEMORY/);assert.match(body.instructions,/Preserve compatible truths/);
    assert.match(body.instructions,/Do not supply missing links from guessed intent/);
    assert.match(body.instructions,/even with no register patch/);
    assert.match(body.instructions,/Flag unquoted direct speech or unclear speakers/);
   }else{
    assert.match(body.instructions,/every genre/);
    assert.match(body.instructions,/genuine denial/);
    assert.match(body.instructions,/Enclose every spoken line in double quotation marks/);
    assert.equal(body.instructions.split("# 집필 스타일").length-1,1);
    assert.match(body.instructions,/NOVEL QUALITY PRINCIPLES/);
    assert.doesNotMatch(body.instructions,/nurse's assigned ward|routine chart request/);
    if(calls===3)assert.equal(JSON.parse(input.corrections).sceneAudit[item.flag],false);
   }
   return response(values.shift(),init);
  });
  const result=await generateChapter({character:{...character,concept:item.context},state:old,direction:`${item.genre} 다음 회차`,key:"test",signal:new AbortController().signal,phase:()=>{}});
  assert.equal(calls,4);assert.equal(result.text,fullDraft(good));assert.equal(result.state.chapter,3);assert.deepEqual(old,before);
 }
});

test("quality instructions keep a bounded shared core and separate prose from review duties",async()=>{
 const writer=await novelWriterQualityInstructions();
 const style=(await readFile("novel_prompt.md","utf8")).trim();
 assert.equal(writer.split(style).length-1,1);
 assert.ok(!novelReviewerQualityInstructions.includes(style));
 assert.ok(writer.length<=3600);
 assert.ok(novelReviewerQualityInstructions.length<=4200);
 assert.ok(writer.length+novelIntegratedReviewInstructions.length<=5000);
 for(const text of [writer,novelReviewerQualityInstructions,writer+novelIntegratedReviewInstructions]){
  assert.equal(text.split("NOVEL QUALITY PRINCIPLES").length-1,1);
  assert.match(text,/each clause affirms or denies/);assert.match(text,/negation scope and contrast/);
  assert.match(text,/Check how clauses connect/);
  assert.match(text,/A decisive inference needs a visible cue/);
  assert.match(text,/Link a closing gesture, message or promise/);
  assert.match(text,/possibly mixed feelings/);assert.match(text,/supported omniscient viewpoint/);
  assert.match(text,/Risky, impulsive or mistaken choices are valid/);
  assert.match(text,/action enabling escape or success/);assert.match(text,/plot-critical props/);
  assert.match(text,/who can see\/hear/);assert.match(text,/Mark time jumps\/returns/);
  assert.match(text,/ordinary ellipsis/);assert.match(text,/explicitly unresolved danger/);
 }
 assert.match(novelReviewerQualityInstructions,/speechIntentClear checks clause links, referents and literal assertions\/negations before inferred intent/);
 assert.match(novelIntegratedReviewInstructions,/speechIntentClear checks clause links, referents and literal assertions\/negations before inferred intent/);
 assert.doesNotMatch(writer,/SCENE AUDIT:|REGISTER MEMORY:/);
 assert.doesNotMatch(novelReviewerQualityInstructions,/WRITING TASK:/);
 assert.match(writer,/in JSON mode place requested metadata only in its separate fields/i);
});

test("mixed feelings, a knowingly risky choice and a tentative interpretation preserve character voice without extra rewrites",async t=>{
 const previous="소라는 동료를 만나고 싶었지만 다칠까 걱정했다. 그의 속마음은 알지 못했다.";
 const old={...emptyStoryState(),chapter:2,seriesArc,summary:previous,previousProse:previous,previousEnding:previous},before=structuredClone(old);
 const event="소라는 무너진 들보를 피해 동료를 구조했다.",fact={text:"동료를 구조했다",evidence:event};
 const draft="동료가 구조 현장으로 돌아온다는 말에 소라는 안도했다. 하지만 곧 무너지는 소리를 듣고 걱정이 앞섰다. 현장 책임자가 기다리라고 했지만, 갇힌 사람의 목소리를 듣자 소라는 위험을 알면서도 안으로 들어갔다. 무모한 선택의 대가는 곧 드러났다. 들보가 떨어져 퇴로를 막았고, 소라는 잠시 몸을 숨긴 뒤 다른 출구를 찾아야 했다. "+event+" 그가 그녀의 머리를 감싸 주자 소라는 마음이 흔들렸다. 자신을 걱정해서였을까. 구조 임무 때문일 수도 있었다. 그 마음의 이름을 정하는 일은 살아서 나간 뒤로 미뤘다.";
 const accepted={...review,newEvents:[fact],endingChange:fact,conceptAlignment:{satisfied:true,evidence:event,fix:"의도된 위험과 감정 유지"},memoryPatch:{...patch,summary:previous+event,currentSituation:fact,newEvents:[fact],resolvedEvents:[],worldFacts:[],characters:[]}};
 let calls=0;t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{calls++;return response(calls===1?draft:accepted,init);});
 const result=await generateChapter({character,state:old,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,2);assert.equal(result.text,fullDraft(draft));assert.deepEqual(old,before);
 assert.ok(result.state.worldFacts.every(text=>!text.includes("사랑")));
});

test("plausible scene ellipsis, unresolved danger and marked time shifts do not force extra rewrites",async t=>{
 const previous="민서는 동료와 함께 기록 보관실에서 편지를 찾고 있었다. 경비는 문밖을 순찰했다.";
 const old={...emptyStoryState(),chapter:2,seriesArc,summary:previous,previousProse:previous,previousEnding:previous},before=structuredClone(old);
 const event="민서는 다음 만남을 약속했다.",fact={text:"다음 만남을 약속했다",evidence:event};
 const drafts=[
  "민서는 문 가까이 다가갔다가 경비의 그림자를 보고 멈췄다. 동료가 복도 반대편에서 경비에게 말을 걸자 민서는 문이 열린 옆방으로 몸을 숨겼다. 편지는 아직 기록실 책상 위에 남아 있었다. 수색이 끝난 것은 아니었고 되찾으려면 기회를 더 기다려야 했다. 경비가 다른 층으로 향하는 발소리가 멀어진 뒤에야 동료가 들어왔다. 둘은 귀를 가까이 대고 돌아갈 길을 의논했다. "+event+" 문밖의 인기척이 다시 들리자 둘은 말을 멈췄다. 당장의 위기를 피했을 뿐, 편지를 가져오는 일은 아직 남아 있었다.",
  "민서는 문밖의 경비가 교대하러 떠나는 모습을 확인했다. 책상 위 편지를 접어 주머니에 넣고 동료에게 빈 책상을 보여 주었다. 둘은 텅 빈 복도를 지나 건물을 나왔다. 정문을 벗어나서야 민서의 어깨에서 힘이 풀렸다. 며칠 뒤, 두 사람은 정원의 벤치에서 다시 만났다. 민서는 보관해 둔 편지를 꺼내 동료에게 건넸다. 그날 돌아온 뒤 알게 된 내용을 나누자 앞으로 할 일이 분명해졌다. "+event+" 둘은 날짜를 달력에 표시한 뒤 각자의 준비를 하러 돌아갔다. 지난밤의 위기를 다시 겪는 대신 이번에는 미리 연락 방법도 정해 두었다.",
 ];
 for(const draft of drafts){
  const accepted={...review,newEvents:[fact],endingChange:fact,conceptAlignment:{satisfied:true,evidence:event,fix:"연결과 의도된 생략 유지"},memoryPatch:{...patch,summary:previous+event,currentSituation:fact,newEvents:[fact],resolvedEvents:[],worldFacts:[],characters:[]}};
  let calls=0;t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
   calls++;const body=JSON.parse(String(init?.body));assert.match(body.instructions,/plot-critical props/);assert.match(body.instructions,/ordinary ellipsis/);
   return response(calls===1?draft:accepted,init);
  });
  const result=await generateChapter({character,state:old,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
  assert.equal(calls,2);assert.equal(result.text,fullDraft(draft));assert.deepEqual(old,before);
 }
});

test("an established couple and a genuine contrast remain valid without another confession or extra calls",async t=>{
 const established="서하와 민수는 이미 서로의 마음을 확인한 연인이다.";
 const old={...emptyStoryState(),chapter:3,seriesArc,summary:established,worldFacts:[established],previousProse:established,previousEnding:established},before=structuredClone(old);
 const event="두 사람은 내일의 일정을 함께 정했다.",fact={text:"함께 일정을 정했다",evidence:event};
 const draft="연인이 된 서하와 민수는 정원 벤치에 나란히 앉아 다음 날 계획을 의논했다. 민수가 길을 잃은 것이냐고 묻자 서하는 웃었다. “길을 잃은 게 아니라 잠깐 쉬는 거야.” 그녀가 지도를 접자 민수도 가방을 내려놓았다. 오늘 걸을 길은 이미 확인했고 남은 시간은 충분했다. 굳이 서두르거나 서로의 마음을 다시 증명할 필요는 없었다. "+event+" 시간을 정하자 두 사람은 한결 편안해진 얼굴로 남은 휴식을 즐겼다.";
 const accepted={...review,newEvents:[fact],endingChange:fact,conceptAlignment:{satisfied:true,evidence:event,fix:"기존 관계 유지"},memoryPatch:{...patch,summary:event,currentSituation:fact,newEvents:[fact],resolvedEvents:[],worldFacts:[],characters:[]}};
 let calls=0;t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  calls++;const body=JSON.parse(String(init?.body));
  assert.match(body.instructions,/established relationships/);
  if(body.text?.format?.name==="chapter_review")assert.match(body.instructions,/known couples need not confess again/);
  return response(calls===1?draft:accepted,init);
 });
 const result=await generateChapter({character,state:old,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,2);assert.equal(result.text,fullDraft(draft));assert.ok(result.state.worldFacts.includes(established));assert.deepEqual(old,before);
});

test("a failed scene check without a grounded fix cannot commit or trigger speculative rewriting",async t=>{
 const old={...emptyStoryState(),chapter:2,seriesArc},before=structuredClone(old);let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  calls++;return response(calls===1?prose:{...review,sceneAudit:{...review.sceneAudit,rolesStable:false}},init);
 });
 await assert.rejects(generateChapter({character,state:old,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}}),/Chapter review failed/);
 assert.equal(calls,2);assert.deepEqual(old,before);
});

test("clear conditional danger and grounded imagery do not create real casualties or another review stage",async t=>{
 const previous="수비대는 전원 생존했고 부상자 세 명은 치료 중이었다.";
 const old={...emptyStoryState(),chapter:2,seriesArc,summary:previous,worldFacts:[previous],previousProse:previous,previousEnding:previous},before=structuredClone(old);
 const event="대장은 세 부상자의 치료를 우선하겠다고 결정했다.",fact={text:"부상자 치료를 우선했다",evidence:event};
 const draft="대장은 돌아온 수비대원의 이름을 하나씩 확인했다. 모두 살아 있었지만 다친 세 사람은 부축을 받아야 했다. 동료가 왜 전열을 벗어났느냐고 묻자 레아는 숲 쪽을 가리켰다. “궁수를 막지 않았다면 동료들이 죽었을 수도 있어요.” 실제로 누구를 잃었다는 말은 아니었다. 목숨을 건 선택을 질책받자 레아의 마음은 차갑게 식었다. 하지만 당장 필요한 것은 말다툼보다 치료였다. "+event+" 레아도 고개를 끄덕이고 동료를 부축했다. 그들의 다음 행동은 분명해졌다.";
 const accepted={...review,newEvents:[fact],endingChange:fact,conceptAlignment:{satisfied:true,evidence:event,fix:"생존 사실 유지"},memoryPatch:{...patch,summary:previous+event,currentSituation:fact,newEvents:[fact],resolvedEvents:[],worldFacts:[],characters:[]}};
 let calls=0;t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{calls++;const body=JSON.parse(String(init?.body));assert.match(body.instructions,/NOVEL QUALITY PRINCIPLES/);return response(calls===1?draft:accepted,init);});
 const result=await generateChapter({character,state:old,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,2);assert.equal(result.text,fullDraft(draft));assert.deepEqual(old,before);assert.ok(result.state.worldFacts.includes(previous));
 assert.ok(result.state.recentEvents.every(text=>!text.includes("사망")&&!text.includes("납치")));
});

const longProse=(prose+Array.from({length:90},(_,i)=>` 서하는 ${i+1}번째 서가를 정리하며 친구와 다음 작업을 의논했다. 약속한 날짜를 지키려면 오늘 이 일을 끝내야 했다.`).join("")).slice(0,2700);
const bundle=(chapter=1,arcChapter=1)=>({chapter,arcChapter,prose:longProse,review:{...review,memoryPatch:patch,...(arcChapter===5?{resolution:{centralConflictResolved:true,protagonistOutcomeShown:true,relationshipOutcomeShown:true,hasSequelHook:false,evidence:fact.evidence,fix:"마무리됨"}}:{})}});

test("integrated trace distinguishes the model verdict from server rejection and identifies the accepted repair",async t=>{
 const keys=["NOVEL_REVIEW_LOG_LEVEL","OPENAI_NOVEL_GENERATION_MODE"],before=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];}));
 Object.assign(process.env,{NOVEL_REVIEW_LOG_LEVEL:"summary",OPENAI_NOVEL_GENERATION_MODE:"integrated"});
 const logs:any[]=[];t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 let calls=0;t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.instructions.split("CONCEPT-LED DRAMA:").length-1,1);return response(calls===1?{...bundle(3,3),prose:"***"}:bundle(3,3));});
 const result=await generateChapter({character,state:{...emptyStoryState(),chapter:2,seriesArc},direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,2);assert.equal(result.text,longProse);
 assert.ok(logs.some(row=>row.event==="integrated_draft"&&row.pass===true&&row.attempt===1));
 assert.ok(logs.some(row=>row.event==="rewrite_requested"&&row.accepted===false&&row.reason==="Integrated episode empty prose"));
 assert.equal(logs.at(-1).event,"completed");assert.equal(logs.at(-1).source,"rewrite");assert.equal(logs.at(-1).proseHash,manuscriptFingerprint(longProse).proseHash);
 assert.ok(!logs.some(row=>row.event==="content"));
});

test("novel prompt tables preserve every canon and source field without mutating saved memory",()=>{
 const timeline={...emptyTimeline(),participants:[{id:"user",name:"당신"},{id:"character",name:"서하"}],canon:Array.from({length:10},(_,i)=>({id:`novel:${i+1}:character:event_${i}`,source:"novel" as const,sourceId:`chapter_${i+1}`,subjectId:"character",objectId:"user",key:`event_${i}`,kind:"event" as const,status:"completed" as const,visibility:i%2?"reader" as const:"character" as const,text:`중요한 사건 ${i}`,evidence:`원고 근거 ${i}`}))};
 const before=structuredClone(timeline),packed=novelTimelineContext(timeline);
 assert.deepEqual(unpack(packed.canon),timeline.canon);assert.deepEqual(unpack(packed.participants),timeline.participants);
 assert.deepEqual(timeline,before);assert.ok(JSON.stringify(packed).length<JSON.stringify(timeline).length);
 const sources=manuscriptSources(longProse),compact=sourceContext(sources);
 assert.deepEqual(unpack(compact),sources);assert.ok(JSON.stringify(compact).length<JSON.stringify(sources).length);
 assert.equal(resolveSources({evidence:sources[0].id},sources).evidence,sources[0].text);
});

test("integrated episodes enforce numbering, full length, grounding, repetition and final resolution",()=>{
 assert.equal(validateIntegratedEpisode(bundle(),1,1,"").charCount,2700);
 const longer = {...bundle(),prose:longProse+"가".repeat(501)};
 assert.equal(validateIntegratedEpisode(longer,1,1,"").charCount,3201);
 assert.throws(()=>validateIntegratedEpisode({...bundle(),review:{...bundle().review,sceneAudit:{...review.sceneAudit,actionsCoherent:false}}},1,1,""),/scene audit/);
 const {sceneAudit:_missing,...noAudit}=bundle().review;
 assert.equal(integratedEpisodeSchema(false).safeParse({...bundle(),review:noAudit}).success,false);
 assert.throws(()=>validateIntegratedEpisode(bundle(),2,1,""),/numbering/);
 assert.equal(validateIntegratedEpisode({...bundle(),prose},1,1,"").text,prose);
 assert.throws(()=>validateIntegratedEpisode({...bundle(),prose:"***"},1,1,""),/empty prose/);
 assert.throws(()=>validateIntegratedEpisode(bundle(),1,1,longProse),/repeats/);
 assert.throws(()=>validateIntegratedEpisode({...bundle(),review:{...review,memoryPatch:{...patch,sharedChanges:[{subjectName:"서하",targetName:null,key:"event_missing",kind:"event",status:"completed",visibility:"character",text:"결혼했다",evidence:"없는 결혼"}]}}},1,1,""),/Unsupported/);
 assert.equal(validateIntegratedEpisode(bundle(5,5),5,5,"").charCount,2700);
 assert.throws(()=>validateIntegratedEpisode({...bundle(5,5),review:{...bundle(5,5).review,resolution:{...bundle(5,5).review.resolution!,hasSequelHook:true}}},5,5,""),/unresolved/);
 assert.equal(integratedEpisodeSchema(false).safeParse({...bundle(),extra:"bad"}).success,false);
});

test("a missed departure promise rejects an otherwise passing draft and logs the repaired outcome",async t=>{
 const prior=process.env.NOVEL_REVIEW_LOG_LEVEL;
 process.env.NOVEL_REVIEW_LOG_LEVEL="summary";
 t.after(()=>{if(prior===undefined)delete process.env.NOVEL_REVIEW_LOG_LEVEL;else process.env.NOVEL_REVIEW_LOG_LEVEL=prior;});
 const logs:{event:string;count?:number;results?:{status:string}[]}[]=[];
 t.mock.method(console,"info",(prefix:unknown,line:unknown)=>{if(prefix==="novel-review-trace")logs.push(JSON.parse(String(line)));});
 const promise={key:"promise_depart",subjectId:"character",objectId:"user",text:"정문에서 만나 함께 출발하기"};
 const timeline={...emptyTimeline(),revision:4,participants:[{id:"character",name:"서하"},{id:"user",name:"당신"}],promises:[promise]};
 const missed="서하는 정문에서 혼자 출발했다.", fulfilled="서하는 정문에서 당신과 함께 출발했다.";
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
  calls++;
  assert.deepEqual(input.context.sharedTimeline.promises,[promise]);
  if(!body.text){
   assert.match(body.instructions,/agreed participants and action on-page/);
   if(calls===3)assert.match(input.corrections,/"status":"missed"/);
   return response(prose+" "+(calls===1?missed:fulfilled),init);
  }
  const status=calls===2?"missed":"fulfilled";
  return response({...review,promiseAudit:[{status,evidence:calls===2?missed:fulfilled}]},init);
 });
 const result=await generateChapter({character,timeline,state:{...emptyStoryState(),chapter:1,seriesArc},direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,4);
 assert.match(result.text,/당신과 함께 출발/);
 assert.deepEqual(result.closedPromises,[promise.text]);
 assert.equal(logs.find(row=>row.event==="promise_context")?.count,1);
 assert.deepEqual(logs.filter(row=>row.event==="promise_audit").map(row=>row.results?.[0].status),["missed","fulfilled"]);
 assert.doesNotMatch(JSON.stringify(logs.filter(row=>row.event.startsWith("promise_"))),/정문/);
});

test("Gemini writes prose only and reports tokens while OpenAI plans and reviews", async t => {
 const keys = ["GEMINI_NOVEL_WRITE_MODEL", "GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_PROVIDER", "GEMINI_DIRECT_API_KEY", "OPENAI_NOVEL_GENERATION_MODE"] as const;
 const saved = keys.map(key => process.env[key]);
 t.after(() => keys.forEach((key, i) => {
  if (saved[i] === undefined) delete process.env[key];
  else process.env[key] = saved[i];
 }));
 process.env.GEMINI_NOVEL_WRITE_MODEL = "gemini-3.5-flash-lite";
 process.env.OPENAI_NOVEL_GENERATION_MODE = "integrated";
 process.env.GEMINI_API_KEY = "gateway-fixture";
 process.env.GEMINI_BASE_URL = "https://gateway.example/v1";
 process.env.GEMINI_PROVIDER = "direct";
 delete process.env.GEMINI_DIRECT_API_KEY;
 const providers: string[] = [];
 const records: import("../lib/usage.ts").UsageRecord[] = [];
 let truncated = false;
 t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  const headers = new Headers(init?.headers);
  if (url.includes("generativelanguage.googleapis.com")) {
   providers.push("gemini");
   assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
   assert.equal(headers.get("x-goog-api-key"), "gemini-fixture");
   assert.equal(headers.get("authorization"), null);
   assert.match(body.systemInstruction.parts[0].text, /# 집필 스타일/);
   assert.equal(body.generationConfig.maxOutputTokens, 6000);
   assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
   return Response.json({
    responseId: "gemini-result", modelVersion: "gemini-3.5-flash-lite",
    candidates: [{finishReason: truncated ? "MAX_TOKENS" : "STOP", content: {parts: [{text: "private thought", thought: true}, {text: fullDraft(prose)}]}}],
    usageMetadata: {promptTokenCount: 50, candidatesTokenCount: 40, thoughtsTokenCount: 10, totalTokenCount: 100},
   });
  }
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(headers.get("x-goog-api-key"), null);
  assert.equal(headers.get("authorization"), "Bearer openai-fixture");
  const name = body.text.format.name;
  providers.push(name);
  return response(name === "chapter_plan" ? plan : review, init);
 });
 const options = {character, direction: "다음", key: "openai-fixture", signal: new AbortController().signal,
  phase: () => {}, onUsage: (record: import("../lib/usage.ts").UsageRecord) => records.push(record)};
 await assert.rejects(generateChapter(options), /Missing Gemini API key/);
 assert.deepEqual(providers, []);
 process.env.GEMINI_DIRECT_API_KEY = "gemini-fixture";
 const result = await generateChapter(options);
 assert.deepEqual(providers, ["chapter_plan", "gemini", "chapter_review"]);
 assert.equal(result.text, fullDraft(prose));
 const write = records.find(record => record.feature === "novel.write" && record.status === "completed");
 assert.deepEqual([write?.inputTokens, write?.outputTokens, write?.reasoningTokens, write?.totalTokens], [50, 50, 10, 100]);
 providers.length = 0;
 truncated = true;
 await assert.rejects(generateChapter({...options, state: {...emptyStoryState(), chapter: 1, seriesArc}}), /Novel output token limit/);
 assert.deepEqual(providers, ["gemini"]);
 assert.equal(records.at(-1)?.status, "failed");
 assert.equal(records.at(-1)?.totalTokens, 100);
});

test("Gemini gateway writes through Chat Completions and preserves usage and error diagnostics", async t => {
 const keys=["GEMINI_NOVEL_WRITE_MODEL","GEMINI_API_KEY","GEMINI_BASE_URL","GEMINI_PROVIDER","OPENAI_BASE_URL"] as const;
 const previous=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
 Object.assign(process.env,{GEMINI_NOVEL_WRITE_MODEL:"gemini-3.5-flash-lite",GEMINI_API_KEY:"gateway-fixture",GEMINI_BASE_URL:"https://gateway.example/v1/",GEMINI_PROVIDER:"vnai",OPENAI_BASE_URL:"https://text-gateway.example/v1"});
 const calls:string[]=[];
 const records: import("../lib/usage.ts").UsageRecord[]=[];
 let outcome="stop";
 t.mock.method(globalThis,"fetch",async(url:string,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));
  const headers=new Headers(init?.headers);
  if(url==="https://text-gateway.example/v1/responses"){
   calls.push("review");
   assert.equal(headers.get("Authorization"),"Bearer openai-fixture");
   assert.equal(body.text.format.name,"chapter_review");
   return response(review,init);
  }
  calls.push("gateway");
  assert.equal(url,"https://gateway.example/v1/chat/completions");
  assert.equal(headers.get("Authorization"),"Bearer gateway-fixture");
  assert.equal(headers.get("x-goog-api-key"),null);
  assert.equal(init?.redirect,"error");
  assert.equal(body.model,"gemini-3.5-flash-lite");
  assert.equal(body.max_tokens,6000);
  assert.equal(body.reasoning_effort,"low");
  assert.equal(body.messages[0].role,"system");
  assert.equal(body.messages[1].role,"user");
  if(outcome==="http-error")return Response.json({error:{code:"rate_limit_exceeded"}},{status:429});
  return Response.json({
   id:"gateway-response",choices:[{finish_reason:outcome,message:{content:longProse,reasoning_content:"private thought"}}],
   usage:{prompt_tokens:82,completion_tokens:54,total_tokens:136,prompt_tokens_details:{cached_tokens:20},completion_tokens_details:{reasoning_tokens:12}},
  });
 });
 const state={...emptyStoryState(),chapter:1,seriesArc};
 const options={character,state,direction:"다음",key:"openai-fixture",signal:new AbortController().signal,phase:()=>{},onUsage:(record:import("../lib/usage.ts").UsageRecord)=>records.push(record)};
 assert.equal((await generateChapter(options)).text,longProse);
 assert.deepEqual(calls,["gateway","review"]);
 const write=records.find(record=>record.feature==="novel.write"&&record.status==="completed");
 assert.deepEqual([write?.responseId,write?.inputTokens,write?.outputTokens,write?.totalTokens,write?.cachedTokens,write?.reasoningTokens],["gateway-response",82,54,136,20,12]);
 calls.length=0;
 outcome="length";
 await assert.rejects(generateChapter(options),/Novel output token limit/);
 assert.deepEqual(calls,["gateway"]);
 assert.equal(records.at(-1)?.status,"failed");
 outcome="http-error";
 await assert.rejects(generateChapter(options),{message:"Novel upstream failed",diagnostics:{provider:"gemini",httpStatus:429,providerErrorCode:"rate_limit_exceeded",providerErrorStatus:null}});
});

const sceneOpening = prose + "\n\n" + "창문 너머로 건너편 가게의 불이 하나씩 꺼졌다.";
const sceneOne = "서하는 공구함을 내려다봤다. 친구는 먼저 손전등을 건넸다. " + "나다라마바".repeat(160);
const sceneTwo = "둘은 함께 수리할 곳을 하나씩 확인했다. " + "차카타파하".repeat(300);

test("Gemini retries a duplicate insertion and reviews a short draft when expansion stops", async t => {
 const keys=["GEMINI_API_KEY","GEMINI_NOVEL_WRITE_MODEL"] as const;
 const previous=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
 process.env.GEMINI_API_KEY="fixture";
 process.env.GEMINI_NOVEL_WRITE_MODEL="gemini-3.5-flash-lite";
 let calls:string[]=[], duplicateScenes=0, duplicateAfter=0, acceptedScenes=0, lastWasDuplicate=false, providerError=false;
 t.mock.method(globalThis,"fetch",async(url:string,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));
  if(!url.includes("generativelanguage")){
   assert.equal(body.text.format.name,"chapter_review");
   calls.push("review");
   const units=unpack(JSON.parse(body.input).sourceUnits);
   assert.equal(units.some(unit=>unit.text.includes("친구는 먼저 손전등을 건넸다")),acceptedScenes>0);
   assert.ok(units.some(unit=>unit.text.includes("건너편 가게의 불이 하나씩 꺼졌다")));
   return response(review,init);
  }
  const instructions=body.systemInstruction.parts[0].text;
  const input=JSON.parse(body.contents[0].parts[0].text);
  if(input.before===undefined){
   calls.push("write");
   assert.match(instructions,/3,000~3,300자/);
   return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:sceneOpening}]}}]});
  }
  calls.push("insert");
  const inserted = acceptedScenes ? "\n\n"+sceneOne : "";
  assert.equal(input.before,prose+(lastWasDuplicate ? "" : inserted));
  assert.equal(input.after,(lastWasDuplicate ? inserted : "")+sceneOpening.slice(prose.length));
  assert.equal(input.minimumChapterChars,2000);
  assert.ok(input.chars<2000);
  assert.deepEqual(input.targetSceneChars,[2800-input.chars,2950-input.chars]);
  assert.match(instructions,/Output only new scene prose/);
  assert.equal(input.retryReason,lastWasDuplicate?"duplicate_scene":undefined);
  if(providerError)return Response.json({error:{status:"UNAVAILABLE"}},{status:503});
  lastWasDuplicate=duplicateScenes>0 && acceptedScenes>=duplicateAfter;
  if(lastWasDuplicate)duplicateScenes--;
  const text=lastWasDuplicate ? prose : acceptedScenes++===0 ? sceneOne : sceneTwo;
  return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text}]}}]});
 });
 const state={...emptyStoryState(),chapter:1,seriesArc};
 const options={character,state,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}};
 assert.equal((await generateChapter(options)).text,prose+"\n\n"+sceneOne+"\n\n"+sceneTwo+sceneOpening.slice(prose.length));
 assert.deepEqual(calls,["write","insert","insert","review"]);
 calls=[];acceptedScenes=0;duplicateScenes=1;
 assert.equal((await generateChapter(options)).text,prose+"\n\n"+sceneOne+"\n\n"+sceneTwo+sceneOpening.slice(prose.length));
 assert.deepEqual(calls,["write","insert","insert","insert","review"]);
 calls=[];acceptedScenes=0;duplicateScenes=2;duplicateAfter=1;
 const fallback=await generateChapter(options);
 assert.equal(fallback.text,prose+"\n\n"+sceneOne+sceneOpening.slice(prose.length));
 assert.ok(fallback.text.length<2000);
 assert.equal(fallback.state.chapter,2);
 assert.equal(fallback.state.previousProse,fallback.text);
 assert.deepEqual(calls,["write","insert","insert","insert","review"]);
 assert.equal(state.chapter,1);
 calls=[];acceptedScenes=0;lastWasDuplicate=false;providerError=true;
 const failedInsert=await generateChapter(options);
 assert.equal(failedInsert.text,sceneOpening);
 assert.deepEqual(calls,["write","insert","review"]);
});

test("critical props survive chapter memory and ungrounded holder changes trigger correction", async t => {
 const item={item:"창고 열쇠",holder:"서하",operator:"민수"};
 const storyCharacter={...character,concept:"서하가 열쇠를 보관하고 민수만 자물쇠를 열기로 했다."};
 const state={...emptyStoryState(),chapter:1,seriesArc,propStates:[item]};
 const wrong="민수는 자기 주머니에서 창고 열쇠를 꺼냈다.";
 const fixed="서하는 창고 열쇠를 쥔 채 민수가 올 때까지 기다렸다.";
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));
  const input=JSON.parse(body.input);
  assert.deepEqual(input.context.memory.propStates,[item]);
  assert.match(body.instructions+JSON.stringify(input),/민수만 자물쇠를 열기로 했다/);
  calls++;
  if(calls===1)return response(longProse+" "+wrong);
  if(calls===2)return response({...review,memoryPatch:{...patch,
   propChanges:[{...item,holder:"민수",evidence:wrong,changeEvidence:null}]}},init);
  if(calls===3){
   assert.match(input.corrections,/established holder and operator/);
   return response(longProse+" "+fixed);
  }
  return response(review,init);
 });
 const result=await generateChapter({character:storyCharacter,state,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,4);
 assert.ok(result.text.endsWith(fixed));
 assert.deepEqual(result.state.propStates,[item]);
 const handoff="서하는 민수에게 창고 열쇠를 건네 보관을 맡겼다.";
 const changed=mergeMemory(state,{...patch,propChanges:[{...item,holder:"민수",evidence:handoff,changeEvidence:handoff}]},prose+" "+handoff,"목표");
 assert.deepEqual(changed.propStates,[{...item,holder:"민수"}]);
});

test("adjacent repeated dialogue is removed before chapter review without another writer call",async t=>{
 const first="“너 정말…… 대담한 소리를 아무렇지도 않게 한다. 누가 갑자기 들어오기라도 하면 어쩌려고 그래.”";
 const repeated=first.replace("너 ","");
 const reply="“그럼 밖에서 얘기하자. 문이 열리는 소리 때문에 여기서는 마음이 영 편치 않아.”";
 const expected=longProse+"\n\n"+first+"\n\n"+reply+"\n\n“응.”\n\n“응.”";
 const draft=expected.replace(reply,repeated+"\n\n"+reply);
 const calls:string[]=[];
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));
  if(!body.text){
   calls.push("write");
   return response(draft);
  }
  assert.equal(body.text.format.name,"chapter_review");
  calls.push("review");
  const units=unpack(JSON.parse(body.input).sourceUnits);
  assert.ok(units.some(unit=>unit.text.includes(first.slice(0,14))));
  assert.ok(!units.some(unit=>unit.text.startsWith(repeated.slice(0,14))));
  return response(review,init);
 });
 const state={...emptyStoryState(),chapter:1,seriesArc};
 const result=await generateChapter({character,state,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(result.text,expected);
 assert.deepEqual(calls,["write","review"]);
});

test("short integrated drafts use a scene-only request then verify the joined manuscript", async t=>{
 const old=process.env.OPENAI_NOVEL_GENERATION_MODE;
 t.after(()=>{if(old===undefined)delete process.env.OPENAI_NOVEL_GENERATION_MODE;else process.env.OPENAI_NOVEL_GENERATION_MODE=old;});
 process.env.OPENAI_NOVEL_GENERATION_MODE="integrated";
 const calls:string[]=[];
 const scene = sceneOne+"\n\n"+sceneTwo;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));
  const name=body.text?.format.name;
  if(name==="episode_bundle"){
   calls.push("bundle");
   return response({...bundle(2,2),prose:sceneOpening});
  }
  if(name==="chapter_review"){
   calls.push("review");
   assert.ok(unpack(JSON.parse(body.input).sourceUnits).some(unit=>unit.text.includes("수리할 곳을 하나씩 확인했다")));
   return response(review,init);
  }
  calls.push("insert");
  assert.equal(JSON.parse(body.input).before,prose);
  return response(scene);
 });
 const state={...emptyStoryState(),chapter:1,seriesArc};
 const result=await generateChapter({character,state,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(result.text,prose+"\n\n"+scene+sceneOpening.slice(prose.length));
 assert.deepEqual(calls,["bundle","insert","review"]);
});

test("integrated generation uses two calls for a new arc, one for existing and finale, and stays opt-in",async t=>{
 const old=process.env.OPENAI_NOVEL_GENERATION_MODE;
 t.after(()=>{if(old===undefined)delete process.env.OPENAI_NOVEL_GENERATION_MODE;else process.env.OPENAI_NOVEL_GENERATION_MODE=old;});
 delete process.env.OPENAI_NOVEL_GENERATION_MODE;assert.equal(novelGenerationMode(),"reviewed");
 process.env.OPENAI_NOVEL_GENERATION_MODE="typo";assert.equal(novelGenerationMode(),"reviewed");
 process.env.OPENAI_NOVEL_GENERATION_MODE="integrated";
 let calls=0,currentChapter=1,arcChapter=1;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  calls++;const body=JSON.parse(String(init?.body));
  if(body.text?.format.name==="chapter_plan"){
   assert.doesNotMatch(body.instructions,/# 집필 스타일/);
   return response(plan,init);
  }
  assert.equal(body.instructions.split("# 집필 스타일").length-1,1);
  assert.equal(body.text.format.name,"episode_bundle");assert.equal(body.instructions.split("최소 2,000자").length-1,1);
  assert.match(body.instructions,/privately plan 3–4 connected scenes/);
  assert.match(body.instructions,/NOVEL QUALITY PRINCIPLES/);assert.match(body.instructions,/SCENE AUDIT/);
  return response({...bundle(currentChapter,arcChapter),prose:longProse.slice(0,2000)});
 });
 const options={character,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}};
 const first=await generateChapter(options);assert.equal(calls,2);assert.equal(first.state.chapter,1);assert.equal(first.text.length,2000);
 calls=0;currentChapter=3;arcChapter=3;
 const state={...emptyStoryState(),chapter:2,seriesArc};const saved=structuredClone(state);
 const middle=await generateChapter({...options,state});assert.equal(calls,1);assert.equal(middle.state.chapter,3);assert.deepEqual(state,saved);
 calls=0;currentChapter=5;arcChapter=5;
 const final=await generateChapter({...options,state:{...state,chapter:4}});assert.equal(calls,1);assert.equal(final.state.nextChapterGoal,"");
 calls=0;currentChapter=4;arcChapter=1;
 const changed=await generateChapter({...options,state:{...state,chapter:3},additionalConcept:"새로운 목표"});assert.equal(calls,2);assert.equal(changed.state.seriesStartChapter,3);assert.equal(changed.state.chapter,4);
});

test("integrated repair is bounded and never advances state or repeats a token-exhausted paid request",async t=>{
 const old=process.env.OPENAI_NOVEL_GENERATION_MODE;process.env.OPENAI_NOVEL_GENERATION_MODE="integrated";
 t.after(()=>{if(old===undefined)delete process.env.OPENAI_NOVEL_GENERATION_MODE;else process.env.OPENAI_NOVEL_GENERATION_MODE=old;});
 const state={...emptyStoryState(),chapter:2,seriesArc},before=structuredClone(state);let calls=0,alwaysBad=false,exhausted=false;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  calls++;const input=JSON.parse(JSON.parse(String(init?.body)).input);
  if(exhausted)return Response.json({status:"incomplete",incomplete_details:{reason:"max_output_tokens"}});
  if(calls===1||alwaysBad)return response({...bundle(3,3),prose:"***"});
  assert.match(input.repair,/empty prose/);return response(bundle(3,3));
 });
 const options={character,state,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}};
 const fixed=await generateChapter(options);assert.equal(calls,2);assert.equal(fixed.state.chapter,3);assert.deepEqual(state,before);
 calls=0;alwaysBad=true;await assert.rejects(generateChapter(options),/validation failed/);assert.equal(calls,2);assert.deepEqual(state,before);
 calls=0;exhausted=true;await assert.rejects(generateChapter(options),/token limit/);assert.equal(calls,1);assert.deepEqual(state,before);
});

test("reviewed generation can omit discarded memory on a rejected draft while keeping independent review",async t=>{
 const old=process.env.OPENAI_NOVEL_GENERATION_MODE;process.env.OPENAI_NOVEL_GENERATION_MODE="reviewed";
 t.after(()=>{if(old===undefined)delete process.env.OPENAI_NOVEL_GENERATION_MODE;else process.env.OPENAI_NOVEL_GENERATION_MODE=old;});
 const failed={...review,pass:false,blockingIssues:[{type:"continuity",evidence:fact.evidence,fix:"원고의 모순을 수정"}],memoryPatch:null};
 const values=[plan,prose,failed,prose,{...review,memoryPatch:patch}];let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{calls++;return response(values.shift(),init);});
 const result=await generateChapter({character,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,5);assert.equal(result.state.chapter,1);assert.equal(result.state.summary,patch.summary);
 const oldState=emptyStoryState(),before=structuredClone(oldState);calls=0;
 values.push(plan,prose,{...review,memoryPatch:null});
 await assert.rejects(generateChapter({character,state:oldState,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}}));
 assert.equal(calls,3);assert.deepEqual(oldState,before);
});

test("integrated API preserves the single-chapter event contract and never publishes a failed bundle",async t=>{
 const keys=["OPENAI_API_KEY","OPENAI_NOVEL_GENERATION_MODE","ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED"];
 const before=keys.map(key=>process.env[key]);
 Object.assign(process.env,{OPENAI_API_KEY:"test",OPENAI_NOVEL_GENERATION_MODE:"integrated",ACCOUNT_FEATURES_ENABLED:"false",NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED:"false"});
 t.after(()=>keys.forEach((key,index)=>{if(before[index]===undefined)delete process.env[key];else process.env[key]=before[index];}));
 let calls=0,bad=false;
 t.mock.method(globalThis,"fetch",async()=>{calls++;return response(bad?{...bundle(3,3),prose:"***"}:bundle(3,3));});
 const state={...emptyStoryState(),chapter:2,seriesArc};
 const request=()=>new Request("http://localhost/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({character,storyState:state,timeline:emptyTimeline(),messages:[{role:"user",content:"다음 이야기"}]})});
 const wire=await(await POST(request())).text();
 const events=wire.split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
 assert.equal(calls,1);assert.equal(events.filter(e=>e.type==="chapter").length,1);
 assert.equal(events.find(e=>e.type==="chapter").state.chapter,3);assert.equal(events.at(-1).type,"done");
 assert.equal(events.filter(e=>e.type==="timeline").length,1);
 bad=true;calls=0;const failed=await(await POST(request())).text();assert.equal(calls,2);
 assert.doesNotMatch(failed,/"type":"chapter"|"type":"timeline"|"type":"done"/);assert.equal(state.chapter,2);
});

test("accepted novel facts cross into chat while later writing receives the full canon without extra calls",async t=>{
 const timeline={...emptyTimeline(),revision:1,participants:[{id:"user",name:"당신"},{id:"character",name:"서하"}],canon:[{id:"chat:fact_1_0",source:"chat" as const,sourceId:"user_1",subjectId:"user",objectId:"character",key:"event_rescue",kind:"event" as const,status:"completed" as const,visibility:"character" as const,text:"서하를 구했다",evidence:"내가 서하를 구했어"}]};
 const changes=[{subjectName:"서하",targetName:null,key:"event_contract",kind:"event",status:"completed",visibility:"character",text:"계약서를 찾았다",evidence:fact.evidence},{subjectName:"서하",targetName:null,key:"event_hidden_date",kind:"event",status:"ongoing",visibility:"reader",text:"독자만 아는 날짜의 의미",evidence:"그가 약속한 수리 날짜가 문서에 적혀 있었다."}];
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));calls++;
  assert.match(body.input,/서하를 구했다/);assert.match(body.instructions,/SHARED CANON/);
  if(body.text?.format.name==="chapter_plan")return response(plan,init);
  if(body.text?.format.name==="chapter_review")return response({...review,memoryPatch:{...patch,sharedChanges:changes}},init);
  return response(prose,init);
 });
 const result=await generateChapter({character,timeline,direction:"다음 이야기",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(calls,3);assert.equal(result.state.chapter,1);assert.equal(result.sharedChanges.length,2);
 const shared=advanceTimeline(timeline,character.name,undefined,result.state,undefined,[],"당신",result.sharedChanges);
 assert.match(JSON.stringify(shared),/독자만 아는/);
 const chatPrompt=conversationInstructions({...character,mode:"chat"},emptyChatMemory(character.name),"찾았어?",shared);
 assert.match(chatPrompt,/계약서를 찾았다/);assert.doesNotMatch(chatPrompt,/독자만 아는 날짜/);
 assert.equal(timelineForChat(shared).canon?.length,2);
 calls=0;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  calls++;const body=JSON.parse(String(init?.body));assert.match(body.input,/독자만 아는 날짜/);
  if(body.text?.format.name==="chapter_review")return response({...review,memoryPatch:{...patch,sharedChanges:[]}},init);
  return response(prose.replaceAll("서랍","책상"),init);
 });
 // A later failure cannot mutate the caller's already accepted shared state.
 const before=JSON.stringify(shared);
 await assert.rejects(generateChapter({character,timeline:shared,state:result.state,direction:"다음",key:"test",signal:new AbortController().signal,phase:()=>{}}));
 assert.equal(JSON.stringify(shared),before);
});

function schemaNode(root:any,node:any):any {
 while(node.$ref) node=node.$ref.split("/").slice(1).reduce((value:any,key:string)=>value[key.replaceAll("~1","/").replaceAll("~0","~")],root);
 return node;
}

test("review schemas share source IDs without relaxing evidence validation",()=>{
 const ids=Array.from({length:180},(_,index)=>`source_${index+1}`) as [string,...string[]];
 const citation=z.enum(ids);
 const schema=createReviewSchema(citation).extend({memoryPatch:createMemoryPatchSchema(citation)});
 const compact=novelJsonSchema(schema);
 assert.ok(JSON.stringify(compact).length < JSON.stringify(z.toJSONSchema(schema)).length*0.6);
 const item=schemaNode(compact,schemaNode(compact,compact.properties!.newEvents).items);
 assert.deepEqual(schemaNode(compact,item.properties.evidence).enum,ids);
 assert.equal(citation.safeParse("source_999").success,false);
});

test("novel speed experiments change planning and writing effort without changing chat or review",async t=>{
 const keys=["OPENAI_REASONING_EFFORT","OPENAI_NOVEL_REASONING_EFFORT","OPENAI_NOVEL_PLAN_REASONING_EFFORT","OPENAI_NOVEL_WRITE_REASONING_EFFORT"];
 const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 t.after(()=>{for(const[key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 process.env.OPENAI_REASONING_EFFORT="medium";process.env.OPENAI_NOVEL_REASONING_EFFORT="high";process.env.OPENAI_NOVEL_PLAN_REASONING_EFFORT="high";process.env.OPENAI_NOVEL_WRITE_REASONING_EFFORT="low";
 const {reasoningOptions}=await import("../lib/ai-model.ts");assert.equal(reasoningOptions().reasoning?.effort,"medium");
 const values:unknown[]=[plan,prose,review];const efforts:string[]=[];
 t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));efforts.push(body.reasoning.effort);return response(values.shift(),init);});
 await generateChapter({character,direction:"첫 이야기",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.deepEqual(efforts,["high","low","low"]);
});

test("first and final chapter plans use the expanded, configurable reasoning and output budget",async t=>{
 const previous=process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS;
 t.after(()=>{if(previous===undefined)delete process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS;else process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS=previous;});
 const {seriesArc: _arc,...nextPlan}=plan;
 for(const budget of [12000,16000]){
  if(budget===12000)delete process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS;else process.env.OPENAI_NOVEL_PLAN_MAX_OUTPUT_TOKENS=String(budget);
  for(const final of [false,true]){
   const state=final?{...emptyStoryState(),chapter:4,seriesArc}:undefined;
   const finalReview={...review,resolution:{centralConflictResolved:true,protagonistOutcomeShown:true,relationshipOutcomeShown:true,hasSequelHook:false,evidence:fact.evidence,fix:"완결"}};
   const values:unknown[]=[final?nextPlan:plan,prose,final?finalReview:review];let calls=0;
   const records:{feature:string;status:string;outputTokens:number|null}[]=[];
   const mocked=t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));calls++;
    const result=response(values.shift(),init);
    if(body.text?.format?.name!=="chapter_plan")return result;
    assert.equal(body.max_output_tokens,budget);assert.deepEqual(body.reasoning,{effort:"medium"});
    return Response.json({...await result.json(),usage:{input_tokens:500,output_tokens:6000,total_tokens:6500,output_tokens_details:{reasoning_tokens:5000}}});
   });
   try{
    const result=await generateChapter({character,state,direction:"다음 이야기",key:"test",signal:new AbortController().signal,phase:()=>{},onUsage:record=>records.push(record)});
    assert.equal(result.state.chapter,final?5:1);assert.equal(calls,3);
    assert.equal(records.find(record=>record.feature==="novel.chapter_plan"&&record.status==="completed")?.outputTokens,6000);
   }finally{mocked.mock.restore();}
  }
 }
});

test("medium reviews have room for reasoning beyond the old cap and still commit only a completed review",async t=>{
 const previous=process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT;
 process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT="medium";
 t.after(()=>{if(previous===undefined)delete process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT;else process.env.OPENAI_NOVEL_REVIEW_REASONING_EFFORT=previous;});
 const values:unknown[]=[plan,prose,review];
 const records:{feature:string;status:string;reasoningTokens:number|null}[]=[];
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
  calls++;const body=JSON.parse(String(init.body));
  const result=response(values.shift(),init);
  if(body.text?.format?.name!=="chapter_review")return result;
  assert.deepEqual(body.reasoning,{effort:"medium"});assert.equal(body.max_output_tokens,12000);
  return Response.json({...await result.json(),usage:{input_tokens:14101,output_tokens:5700,total_tokens:19801,output_tokens_details:{reasoning_tokens:5000}}});
 });
 const result=await generateChapter({character,direction:"첫 이야기",key:"test",signal:new AbortController().signal,phase:()=>{},onUsage:record=>records.push(record)});
 assert.equal(result.state.chapter,1);assert.equal(calls,3);
 assert.equal(records.find(record=>record.feature==="novel.chapter_review"&&record.status==="completed")?.reasoningTokens,5000);
});

test("a reused outline still reviews and repairs a grounded continuity error at most once",async t=>{
 const bad={...review,pass:false,blockingIssues:[{type:"continuity",evidence:fact.evidence,fix:"확정된 인물 관계를 유지한다"}]};
 const values:unknown[]=[prose,bad,prose,review];
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
  calls++;const body=JSON.parse(String(init.body));assert.notEqual(body.text?.format?.name,"chapter_plan");
  if(calls===3)assert.equal(JSON.parse(JSON.parse(body.input).corrections).issues[0].type,"continuity");
  return response(values.shift(),init);
 });
 const old={...emptyStoryState(),chapter:1,seriesArc,longTermGoal:plan.longTermGoal};
 const before=structuredClone(old);
 const result=await generateChapter({character,state:old,direction:"이어서 써줘",key:"test",signal:new AbortController().signal,phase:()=>{}});
 assert.equal(result.state.chapter,2);assert.equal(calls,4);assert.deepEqual(old,before);
});

test("additional concepts replan five future chapters without resetting actual history, even after completion", async t => {
  for (const chapter of [3, 5]) {
    const old = { ...emptyStoryState(), chapter, seriesArc, seriesConcept:"엘리는 분홍색 머리의 사제다.", summary: "서점 정리를 시작했다", longTermGoal: "예전 목표" };
    const before = structuredClone(old);
    const newArc = { ...seriesArc, endingPromise: "라이벌과 함께 새로운 서점을 연다" };
    const values: unknown[] = [{ ...plan, seriesArc: newArc, longTermGoal: "라이벌과 서점 운영" }, prose, review];
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.reasoning,{effort:body.text?.format?.name==="chapter_review"?"low":"medium"});
      assert.doesNotMatch(body.instructions,/exactly 10 numbered installments/);
      const input = JSON.parse(body.input);
      if (body.text?.format?.name === "chapter_plan") {
        assert.equal(input.schedule.chapter, 1);
        assert.equal(input.schedule.remainingAfterThis, 4);
        assert.equal(input.memory.summary, before.summary);
        assert.equal(input.additionalConcept, "라이벌과 화해하고 동업한다");
        assert.ok(body.text.format.schema.required.includes("seriesArc"));
      }
      if (!body.text) {
        assert.equal(input.context.installmentGoal.chapter, 1);
        assert.deepEqual(input.context.earlierConcepts,[old.seriesConcept]);
        assert.match(body.instructions,/explicit appearance across chapters/);
      }
      return response(values.shift(), init);
    });
    const options = { character, state: old, additionalConcept: "라이벌과 화해하고 동업한다", direction: "이어서 써줘", key: "test", signal: new AbortController().signal, phase: () => {} };
    const result = await generateChapter(options);
    assert.equal(result.expectedChapter, chapter);
    assert.equal(result.state.chapter, chapter + 1);
    assert.equal(result.state.seriesStartChapter, chapter);
    assert.equal(result.state.seriesConcept, options.additionalConcept);
    assert.deepEqual(storyConceptsForChapter(result.state,chapter),[old.seriesConcept]);
    assert.deepEqual(storyConceptsForChapter(result.state,chapter+1),[old.seriesConcept,options.additionalConcept]);
    assert.equal(result.state.longTermGoal, "라이벌과 서점 운영");
    assert.deepEqual(result.state.seriesArc, newArc);
    assert.equal(storyProgress(result.state), 1);
    assert.equal(storyComplete(result.state), false);
    assert.deepEqual(old, before);
    await assert.rejects(generateChapter({ ...options, additionalConcept: undefined, state: { ...result.state, chapter: chapter + 5 } }), /already complete/);
    assert.equal(calls, 3);
    mock.mock.restore();
  }
});

test("user-required outcomes block even an otherwise resolved ending; one repair or no commit", async t => {
  const requiredEnding = "남편이 밀회를 발견한다. 롤랑은 루이를 지키다가 죽고 루이도 그의 곁에서 숨을 거둔다.";
  const tragicCharacter = { ...character, name: "루이", concept: "공주 루이는 정략결혼 후에도 소꿉친구 롤랑과 밀회를 즐긴다." };
  const { seriesArc: omitted, ...nextPlan } = plan;
  void omitted;
  const finalReview = { ...review, resolution: { centralConflictResolved: true, protagonistOutcomeShown: true, relationshipOutcomeShown: true, hasSequelHook: false, evidence: fact.evidence, fix: "완결" } };
  const violation = { ...finalReview, pass: true, conceptAlignment: { satisfied: false, evidence: fact.evidence, fix: requiredEnding } };
  for (const repaired of [true, false]) {
    const old = { ...emptyStoryState(), chapter: 4, seriesArc, seriesConcept: requiredEnding, longTermGoal: "계약서로 결혼을 무효화하고 탈출" };
    const before = structuredClone(old);
    const values: unknown[] = [{ ...nextPlan, longTermGoal: requiredEnding }, prose, violation, prose, repaired ? finalReview : violation];
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      const input = JSON.parse(body.input);
      assert.match(body.instructions, /seriesConcept > explicit character.concept > makjang/);
      assert.match(body.instructions, /치정/);
      assert.equal((input.context ?? input).seriesConcept, requiredEnding);
      if (body.text?.format?.name === "chapter_review") {
        assert.ok(body.text.format.schema.required.includes("conceptAlignment"));
        assert.match(body.instructions, /ALL specified outcomes must actually occur/);
      }
      if (calls === 4) assert.equal(JSON.parse(input.corrections).unmetUserRequirements.fix, requiredEnding);
      return response(values.shift(), init);
    });
    const generation = generateChapter({ character: tragicCharacter, state: old, direction: "마지막 회차", key: "test", signal: new AbortController().signal, phase: () => {} });
    if (repaired) {
      const result = await generation;
      assert.equal(result.state.longTermGoal, requiredEnding);
      assert.equal(result.state.seriesConcept, requiredEnding);
    } else await assert.rejects(generation, /Chapter review failed/);
    assert.equal(calls, 5);
    assert.deepEqual(old, before);
    mock.mock.restore();
  }
});

test("source references select real manuscript passages instead of generated quotations", () => {
  const sources = manuscriptSources("“반가워.” 서하는 손을 내밀었다.\n응. " + "긴 문장".repeat(150));
  assert.ok(sources.every(source => source.text.length <= 360));
  const quoted = resolveSources({ evidence: sources[0].id, nested: [{ evidence: sources[1].id }] }, sources);
  assert.equal(quoted.evidence, sources[0].text);
  assert.equal(quoted.nested[0].evidence, sources[1].text);
  assert.throws(() => resolveSources({ evidence: "서하는 달아났다" }, sources), /Invalid manuscript source/);
});

test("a five-part arc is stored once and follows the remaining chapter schedule", async t => {
  let state = emptyStoryState();
  for (let chapter = 1; chapter <= 4; chapter++) {
    const distinctPassage = Array.from({ length: 500 }, (_, index) => String.fromCharCode(0xac00 + chapter * 600 + index)).join("");
    const values: unknown[] = [...(chapter === 1 ? [plan] : []), prose + distinctPassage, review];
    let calls=0;
    const mocked = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls++;
      const input = JSON.parse(body.input);
      const context = input.context ?? input;
      if (body.text?.format?.name === "chapter_plan") {
        assert.equal(chapter,1);
        assert.equal(context.schedule.chapter, chapter);
        assert.equal(context.schedule.totalChapters, 5);
        assert.equal(context.schedule.remainingAfterThis, 5 - chapter);
        assert.equal(body.text.format.schema.required.includes("seriesArc"), chapter === 1);
      }
      if(chapter>1&&!body.text){assert.match(body.instructions,/privately plan 3–4 connected scenes/);assert.equal(context.installmentGoal.chapter,chapter);assert.deepEqual(context.seriesArc.installments.rows,seriesArc.installments.map(({chapter,goal,payoff})=>[chapter,goal,payoff]));}
      return response(values.shift(), init);
    });
    const result = await generateChapter({ character, state, direction: "다음 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
    state = result.state;
    assert.equal(state.chapter, chapter);
    assert.deepEqual(state.seriesArc, seriesArc);
    assert.equal(calls,chapter===1?3:2);
    mocked.mock.restore();
  }
  assert.equal(seriesSchedule(4).phase, "climax");
  assert.equal(seriesSchedule(3).phase, "convergence");
  assert.equal(seriesSchedule(5).phase, "finale");
  assert.equal(storyComplete(state), false);
  assert.equal(seriesArcSchema.safeParse({ ...seriesArc, installments: seriesArc.installments.slice(0, 4) }).success, false);
  assert.equal(seriesArcSchema.safeParse({ ...seriesArc, installments: seriesArc.installments.map(item => ({ ...item, chapter: 1 })) }).success, false);
});

test("legacy ten-part saved plans load and replan five parts without resetting global progress", async t => {
  const legacyArc = { ...seriesArc, installments: Array.from({ length: 10 }, (_, index) => ({ chapter: index + 1, goal: "기존 목표", payoff: "기존 결과" })) };
  const old = storyStateSchema.parse({ ...emptyStoryState(), chapter: 3, seriesArc: legacyArc, summary: "세 회차의 사건은 이미 진행됐다" });
  const before = structuredClone(old);
  assert.equal(seriesArcSchema.safeParse(legacyArc).success, false);
  const values: unknown[] = [plan, prose, review];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body));
    if (calls === 1) {
      const context = JSON.parse(body.input);
      assert.equal(context.chapter, 4);
      assert.equal(context.schedule.chapter, 4);
      assert.equal(context.memory.summary, old.summary);
      assert.ok(body.text.format.schema.required.includes("seriesArc"));
    }
    return response(values.shift(), init);
  });
  const result = await generateChapter({ character, state: old, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} });
  assert.equal(result.state.chapter, 4);
  assert.equal(result.state.seriesStartChapter, 0);
  assert.equal(result.state.seriesArc?.installments.length, 5);
  assert.equal(storyProgress(result.state), 4);
  assert.deepEqual(old, before);
  assert.equal(calls, 3);
});

test("the fifth chapter must resolve the story, permits one repair, and cannot generate a sixth", async t => {
  const { seriesArc: omitted, ...nextPlan } = plan;
  void omitted;
  const resolution = { centralConflictResolved: true, protagonistOutcomeShown: true, relationshipOutcomeShown: true, hasSequelHook: false, evidence: fact.evidence, fix: "해결됨" };
  const finalReview = { ...review, resolution };
  const unfinished = { ...finalReview, resolution: { ...resolution, centralConflictResolved: false, hasSequelHook: true, fix: "핵심 갈등을 해결하고 후속편 암시를 없앤다" } };
  let values: unknown[] = [nextPlan, prose, unfinished, prose, finalReview];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.text?.format?.name === "chapter_review") assert.ok(body.text.format.schema.required.includes("resolution"));
    if (!body.text) { assert.match(body.instructions, /THIS IS THE FINAL CHAPTER/); assert.match(body.instructions, /No cliffhanger/); }
    calls++;
    return response(values.shift(), init);
  });
  const state = { ...emptyStoryState(), chapter: 4, seriesArc, nextChapterGoal: "서점 개점" };
  const before = structuredClone(state);
  const options = { character, state, direction: "다음 장면", key: "test", signal: new AbortController().signal, phase: () => {} };
  const result = await generateChapter(options);
  assert.equal(calls, 5);
  assert.equal(result.state.chapter, 5);
  assert.equal(result.state.nextChapterGoal, "");
  assert.equal(storyComplete(result.state), true);
  assert.deepEqual(state, before);
  await assert.rejects(generateChapter({ ...options, state: result.state }), /already complete/);
  assert.equal(calls, 5);
  values = [nextPlan, prose, unfinished, prose, unfinished]; calls = 0;
  await assert.rejects(generateChapter(options), /review failed/);
  assert.equal(calls, 5);
  assert.deepEqual(state, before);
});

test("the API rejects requests beyond chapter five before any model call", async t => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Should not call the model"); });
  const result = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character, storyState: { ...emptyStoryState(), chapter: 5, seriesArc }, messages: [{ role: "user", content: "계속 써줘" }] }) }));
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /완결/);
});

test("a passing review with source IDs commits the first chapter without a quotation rewrite", async t => {
  let calls = 0;
  const values: unknown[] = [plan, prose, review];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const input = JSON.parse(body.input);
    if (["chapter_review", "memory_patch"].includes(body.text?.format?.name)) {
      assert.equal(input.context.sharedTimeline.revision, 3);
      assert.equal(input.context.memory.currentSituation, undefined);
      assert.equal(input.draft, undefined);
      assert.equal(input.context.memory.seriesArc, undefined);
      assert.ok(body.text.format.schema.required.includes("memoryPatch"));
      assert.ok(unpack(input.sourceUnits).length > 0);
      const root=body.text.format.schema;
      const item=schemaNode(root,schemaNode(root,root.properties.newEvents).items);
      assert.deepEqual(schemaNode(root,item.properties.evidence).enum, unpack(input.sourceUnits).map((unit: { id: string }) => unit.id));
      assert.equal(input.context.character.imageDescription,undefined);
      assert.equal(input.context.seriesArc.installments,undefined);
      assert.doesNotMatch(body.instructions, /You are writing immersive fictional character roleplay/);
    }
    calls++;
    return response(values.shift(), init);
  });
  const timeline = { ...emptyTimeline(), revision: 3, scene: [{ subjectId: "character", text: "서점에서 재회" }], participants: [{ id: "user", name: "당신" }, { id: "character", name: "서하" }] };
  const result = await generateChapter({ character, timeline, direction: "첫 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
  assert.equal(result.state.chapter, 1); assert.equal(calls, 3);
});

test("novel pipeline plans, writes, reviews and merges only grounded events; writer gets compact memory", async t => {
  const previousModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = "gpt-5.4-mini";
  t.after(() => {
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  });
  const old = { ...emptyStoryState(), chapter: 3, summary: "친구와 약속했다", worldFacts: ["서점은 도시 안에 있다"], resolvedEvents: ["친구와 화해함"], previousProse: "이전 전체 원고", previousEnding: "문 앞에 섰다", nextChapterGoal: "문을 연다" };
  const before = structuredClone(old);
  const bodies: Record<string, unknown>[] = [];
  const values = [plan, prose, review];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); bodies.push(body);
    assert.equal(body.model, "gpt-5.4-mini"); assert.equal(body.store, false);
    return response(values.shift(), init);
  });
  const phases: string[] = [];
  const result = await generateChapter({ character, state: old, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: value => phases.push(value) });
  assert.equal(result.expectedChapter, 3); assert.equal(result.state.chapter, 4);
  assert.deepEqual(old, before);
  assert.deepEqual(result.state.worldFacts, ["서점은 도시 안에 있다", fact.text]);
  assert.ok(result.state.resolvedEvents.includes("친구와 화해함"));
  assert.equal(result.state.characters[0].knowledge[0], fact.text);
  assert.ok(!String(bodies[1].input).includes("이전 전체 원고"));
  assert.ok(String(bodies[1].input).includes("친구와 화해함"));
  assert.deepEqual(phases, ["planning", "writing", "reviewing", "remembering"]);
});

test("grounded repetition permits one rewrite; repeated failure never advances memory", async t => {
  const bad = { ...review, pass: false, blockingIssues: [{ type: "no_progress", evidence: fact.evidence, fix: "정리를 실제로 진행하라" }] };
  let values: unknown[] = [plan, prose, bad, prose, review];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
  const state = emptyStoryState();
  const options = { character, state, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} };
  assert.equal((await generateChapter(options)).state.chapter, 1);
  assert.equal(calls, 5);
  values = [plan, prose, bad, prose, bad]; calls = 0;
  await assert.rejects(generateChapter(options), /review failed/);
  assert.equal(calls, 5); assert.equal(state.chapter, 0);
});

test("partial beat completion and advisory missing beats do not reject meaningful progression", async t => {
  for (const critique of [
    { ...review, completedBeats: [1, 2] },
    { ...review, pass: false, completedBeats: [1, 2], blockingIssues: [{ type: "missing_beat", evidence: fact.evidence, fix: "나머지 장면은 다음 화에 이어간다" }] },
  ]) {
    const values: unknown[] = [{ ...plan, beats: [...plan.beats, plan.beats[0]] }, prose, critique];
    let calls = 0;
    const mocked = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
    const result = await generateChapter({ character, direction: "다음 장면", key: "test", signal: new AbortController().signal, phase: () => {} });
    assert.equal(result.state.chapter, 1); assert.equal(calls, 3);
    mocked.mock.restore();
  }
});

test("ungrounded criticism cannot trigger a rewrite and unsupported memory cannot commit", async t => {
  let values: unknown[] = [plan, prose, { ...review, pass: false, blockingIssues: [{ type: "continuity", evidence: "원고에 없는 비밀 문장", fix: "수정" }] }];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; return response(values.shift(), init); });
  const options = { character, direction: "이어줘", key: "test", signal: new AbortController().signal, phase: () => {} };
  await assert.rejects(generateChapter(options)); assert.equal(calls, 3);
  values = [plan, prose, { ...review, memoryPatch: { ...patch, worldFacts: [{ text: "왕이 죽었다", evidence: "왕이 쓰러졌다" }] } }];
  await assert.rejects(generateChapter(options));
  assert.throws(() => mergeMemory(emptyStoryState(), { ...patch, characters: [{ name: "친구", goal: { text: "복수", evidence: "나는 복수한다" }, knowledge: [], relationships: [] }] }, prose, "서점"), /Unsupported/);
});

test("novel stages reject malformed or incomplete responses and propagate cancellation", async t => {
  const controller = new AbortController();
  let mode = "invalid";
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.signal, controller.signal);
    if (mode === "incomplete") return Response.json({ status: "incomplete", output: [] });
    return response({ wrong: true });
  });
  const options = { character, direction: "이어줘", key: "test", signal: controller.signal, phase: () => {} };
  await assert.rejects(generateChapter(options));
  mode = "incomplete"; await assert.rejects(generateChapter(options), /Incomplete/);
  controller.abort(); await assert.rejects(generateChapter(options), { name: "AbortError" });
});

test("memory stays bounded, detects copied prose and rejects excessive client state", () => {
  const state = { ...emptyStoryState(), recentEvents: Array.from({ length: 24 }, (_, i) => `이전 사건${i}`), resolvedEvents: Array.from({ length: 24 }, (_, i) => `해결${i}`), openThreads: ["미해결"] };
  const updated = mergeMemory(state, { ...patch, closedThreads: [{ text: "미해결", evidence: fact.evidence }] }, prose, "서점");
  assert.equal(updated.recentEvents.length, 8); assert.equal(updated.resolvedEvents.length, 24);
  assert.deepEqual(updated.openThreads, []);
  assert.equal(repeatsPrevious(prose, prose.replaceAll(" ", "\n")), true);
  assert.equal(repeatsPrevious(prose, "바다로 항해했다.".repeat(40)), false);
  assert.equal(storyStateSchema.safeParse({ ...state, previousProse: "x".repeat(8001) }).success, false);
  const crowded = { ...state, previousProse: "x".repeat(8000),
    worldFacts: Array.from({ length: 16 }, (_, i) => `${i}${"사실".repeat(100)}`),
    characters: Array.from({ length: 6 }, (_, i) => ({ name: `인물${i}`, goal: "목표", knowledge: Array.from({ length: 6 }, (_, j) => `${j}${"지식".repeat(100)}`), relationships: ["친구"] })) };
  const copy = structuredClone(crowded);
  const bounded = mergeMemory(crowded, patch, prose.repeat(8).slice(0, 8000), "서점");
  assert.ok(JSON.stringify(bounded).length <= 16000);
  assert.deepEqual(crowded, copy);
});

test("story API publishes no draft or memory when extraction fails", async t => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  const values = [plan, prose, { ...review, memoryPatch: { wrong: true } }];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => response(values.shift(), init));
  const result = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character, messages: [{ role: "user", content: "첫 장면" }] }) }));
  const wire = await result.text();
  assert.ok(wire.includes('"type":"error"'));
  assert.ok(!wire.includes('"type":"chapter"'));
  assert.ok(!wire.includes(prose)); assert.ok(!wire.includes('"type":"done"'));
});

test("review token exhaustion preserves failed usage and returns a specific error without paid retries",async t=>{
 const keys=["OPENAI_API_KEY","ACCOUNT_FEATURES_ENABLED","NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED"];
 const old=keys.map(key=>process.env[key]);
 process.env.OPENAI_API_KEY="test-key";process.env.ACCOUNT_FEATURES_ENABLED="false";process.env.NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED="false";
 t.after(()=>keys.forEach((key,index)=>{if(old[index]===undefined)delete process.env[key];else process.env[key]=old[index];}));
 let calls=0;
 t.mock.method(globalThis,"fetch",async(_url:string,init:RequestInit)=>{
  calls++;const body=JSON.parse(String(init.body));
  if(calls<3)return response(calls===1?plan:prose,init);
  assert.equal(body.text.format.name,"chapter_review");
  assert.deepEqual(body.reasoning,{effort:"low"});assert.equal(body.max_output_tokens,12000);
  return Response.json({id:"review_limit",status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output:[],usage:{input_tokens:14101,output_tokens:12000,total_tokens:26101,output_tokens_details:{reasoning_tokens:12000}}});
 });
 const result=await POST(new Request("http://localhost/api/chat",{method:"POST",headers:{"Content-Type":"application/json","X-Track-Usage":"1"},body:JSON.stringify({character,messages:[{role:"user",content:"첫 이야기"}]})}));
 const wire=await result.text();assert.equal(calls,3);
 assert.match(wire,/output_token_limit/);assert.match(wire,/자동 재시도는 하지 않았/);
 assert.ok(!wire.includes('"type":"chapter"'));assert.ok(!wire.includes('"type":"done"'));
 const events=wire.split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
 const record=events.filter(event=>event.type==="usage").map(event=>event.record).find(record=>record.responseId==="review_limit");
 assert.equal(record.status,"failed");assert.equal(record.totalTokens,26101);assert.equal(record.reasoningTokens,12000);
});
