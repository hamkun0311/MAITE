import test from "node:test";
import assert from "node:assert/strict";
import {agreedVisualDestination,updateVisualScene,rebuildVisualScene,visualSceneKeywords} from "../lib/chat/visual-scene.ts";
import {mentionsClothing,outfitContext,visualKeywords} from "../lib/chat/presentation.ts";
import {emptyChatMemory} from "../lib/chat/memory.ts";
import {selectImageScene} from "../lib/characters/scene-selection.ts";

test("sportswear names are detected and retained in scene and image selection",()=>{
 for(const outfit of ["스포츠브라와 돌핀팬츠","스포츠 브라와 돌핀 팬츠"]){
  assert.equal(mentionsClothing([{role:"user",content:outfit}]),true);
  const user=`너 ${outfit}로 갈아입어줘.`;
  const answer=`응, ${outfit}로 갈아입었어.`;
  const scene=updateVisualScene({location:"공원",turn:0},user,answer);
  assert.ok(scene.outfit?.includes(outfit.includes("스포츠 브라")?"스포츠 브라":"스포츠브라"));
  assert.ok(scene.outfit?.includes(outfit.includes("돌핀 팬츠")?"돌핀 팬츠":"돌핀팬츠"));
  const selection=selectImageScene(outfitContext([{role:"user",content:user},{role:"assistant",content:answer}],undefined,scene),{mode:"chat",profileName:"지수",userNames:["햄군"]});
  assert.equal(selection.outfit,scene.outfit);
 }
});

test("agreed immediate school visit enables a drawable destination without fabricating arrival",()=>{
 const user="그냥 오랜만에 온김에 ㅋㅋㅋ 우리 옛날에 다녔던 학교 가볼래 ?";
 const answer="좋아, 가보자 ㅋㅋ\n\n오랜만에 보면 느낌 좀 이상하겠다.";
 assert.equal(agreedVisualDestination(user,answer),"학교");
 const scene=updateVisualScene({location:"카페",outfit:"흰 셔츠",turn:1},user,answer);
 assert.equal(scene.location,"카페");assert.equal(scene.destination,"학교");assert.equal(scene.outfit,"흰 셔츠");
 const context=outfitContext([{role:"user",content:user},{role:"assistant",content:answer}],undefined,scene);
 const selection=selectImageScene(context,{mode:"chat",profileName:"지수",userNames:["햄군"]});
 assert.equal(selection.location,"학교");assert.equal(selection.outfit,"흰 셔츠");assert.match(context,/not an established arrival/);
 assert.equal(updateVisualScene(scene,"뭐 마실래?","커피 마실래.").destination,undefined);
 for(const [request,reply] of [
  ["내일 학교 가볼래?","좋아, 가보자."],["다음 주에 학교 가자.","그래, 가자."],
  ["학교 가볼래?","좋지만 나중에 가자."],["학교 가볼래?","아직 못 가."],
  ["학교 가볼래?","오늘은 가지 말자."],["학교 가볼래?","추억이 많지."],
  ["나 혼자 학교 갈까?","응, 가보자."],["‘학교 가볼래’라는 대사를 봤어.","좋아, 가보자."],
 ])assert.equal(agreedVisualDestination(request,reply),undefined,request+reply);
});

test("the user's current tteokbokki shop survives a generic affirmative character answer",()=>{
 const scene=updateVisualScene({turn:0},"여기가 내가 찾은 떡볶이집이야. 들어갈까 ?","응, 들어가자. 여기 맞으면 좋겠다 ㅋㅋ\n\n나 배고파서 빨리 먹고 싶어.");
 assert.equal(scene.location,"떡볶이집");
 const following=updateVisualScene(scene,"뭐 먹을까?","난 매운맛이 좋아.");
 assert.equal(following.location,"떡볶이집");assert.deepEqual(visualSceneKeywords(following),["장소: 떡볶이집"]);
 const context=outfitContext([{role:"user",content:"뭐 먹을까?"},{role:"assistant",content:"난 매운맛이 좋아."}],undefined,following);
 assert.ok(context.includes('"location":"떡볶이집"'));assert.deepEqual(visualKeywords(context),["장소: 떡볶이집"]);
 assert.equal(updateVisualScene({turn:0},"여기가 내가 찾은 떡볶이집이야 들어갈까?","응 들어가자.").location,"떡볶이집");
});
test("a new place retains the outfit and a new outfit retains the place",()=>{
 const initial={location:"떡볶이집",outfit:"검은 코트",turn:1};
 const moved=updateVisualScene(initial,"우리 카페에 도착했어.","응, 여기 앉자.");
 assert.equal(moved.location,"카페");assert.equal(moved.outfit,"검은 코트");
 const dressed=updateVisualScene(moved,"너 흰 셔츠로 갈아입어줘.","응, 갈아입었어.");
 assert.equal(dressed.location,"카페");assert.equal(dressed.outfit,"흰 셔츠");
 assert.equal(initial.location,"떡볶이집");
});
test("future plans, a refusal and the user's own clothes do not overwrite the character's scene",()=>{
 const initial={location:"떡볶이집",outfit:"검은 코트",turn:2};
 for(const [user,answer] of [["내일 카페에 가자.","응 내일 가자."],["너 드레스 입어줘.","싫어. 지금 코트 그대로 입을래."],["나는 파란 셔츠를 입었어.","잘 어울리네."],["나는 혼자 서점에 도착했어.","난 여기서 기다릴게."]]){
  const result=updateVisualScene(initial,user,answer);assert.equal(result.location,initial.location);assert.equal(result.outfit,initial.outfit);
 }
});
test("new confirmed character memory takes priority and old facts cannot revert a local update",()=>{
 const memory=emptyChatMemory("지수");memory.turn=3;
 memory.facts=[{id:"fact_3_0",subjectId:"character",objectId:null,action:"current_location",value:"홍대 떡볶이집 창가 자리",certainty:"asserted",sourceTurnId:"character_3",evidence:"여기 앉자"}];
 const result=updateVisualScene({location:"카페",outfit:"흰 셔츠",turn:2},"여기야","응",memory);
 assert.equal(result.location,"홍대 떡볶이집 창가 자리");
 const next=updateVisualScene({...result,location:"서점"},"안녕","반가워",memory);assert.equal(next.location,"서점");
});
test("legacy completed exchanges rebuild local scene memory without consuming greetings or pending turns",()=>{
 const result=rebuildVisualScene([{role:"user",content:"여기 떡볶이집에 도착했어."},{role:"assistant",content:"응 들어가자."},{role:"assistant",content:"카페야?",checkinId:"greeting"},{role:"user",content:"다음엔 서점에 가자"}]);
 assert.equal(result.location,"떡볶이집");assert.equal(result.turn,1);
 const restored=JSON.parse(JSON.stringify(result));assert.equal(updateVisualScene(restored,"맛있지?","응").location,"떡볶이집");
});
