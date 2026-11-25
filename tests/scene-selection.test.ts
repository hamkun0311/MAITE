import test from "node:test";
import assert from "node:assert/strict";
import {selectImageScene} from "../lib/characters/scene-selection.ts";
import {visualInstructions,SCENE_TARGET_DIRECTION} from "../lib/characters/visual.ts";
import {outfitContext} from "../lib/chat/presentation.ts";
import {buildCharacterPrompt,illustrationBrief} from "../lib/characters/schema.ts";
test("structured chat scene retains local location/outfit and targets the created character",()=>{
 const context=outfitContext([{role:"user",content:"여기 떡볶이집이야."},{role:"assistant",content:"응 들어가자."}],undefined,{location:"떡볶이집",outfit:"흰 셔츠",turn:1});
 const result=selectImageScene(context,{mode:"chat",profileName:"지수",userNames:["햄군"],knownNames:["민수"]});
 assert.equal(result.location,"떡볶이집");assert.equal(result.outfit,"흰 셔츠");assert.deepEqual(result.characters,["지수"]);assert.equal(result.target,"지수");
});
test("an absent profile does not donate its identity or outfit to the non-user counterpart",()=>{
 const context="Latest completed chapter (current action):\n지수는 이곳에 없었다. 햄군은 민수와 카페에서 마주 앉았다. 민수는 파란 셔츠를 입었다.";
 const result=selectImageScene(context,{mode:"story",profileName:"지수",userNames:["햄군"],knownNames:["민수","햄군"]});
 assert.deepEqual(result.characters,["민수"]);assert.equal(result.target,"민수");assert.equal(result.outfit,"파란 셔츠");assert.equal(result.location,"카페");
 assert.ok(visualInstructions({kind:"illustration",context,selection:result}).includes(SCENE_TARGET_DIRECTION));
});
test("concept self names and off-screen mentions are excluded; empty scenes do not invent a target",()=>{
 const context="Previous chapter:\n지수와 롤랑이 만났다.\nLatest completed chapter (current action):\n지수는 떠났다. 롤랑은 점원과 카페에서 이야기했다.";
 const result=selectImageScene(context,{mode:"story",profileName:"지수",userNames:["수호기사 롤랑","햄군"],knownNames:["롤랑"]});
 assert.deepEqual(result.characters,["점원"]);assert.equal(result.target,"점원");
 const empty=selectImageScene("Latest completed chapter (current action):\n텅 빈 카페에는 아무도 없었다.",{mode:"story",profileName:"지수",userNames:["햄군"]});
 assert.deepEqual(empty.characters,[]);assert.equal(empty.target,undefined);
});
test("the actual user's counterpart takes priority over an unrelated visible bystander",()=>{
 const result=selectImageScene("Latest completed chapter (current action):\n지수는 이곳에 없었다. 영희는 책을 읽었다. 햄군은 민수와 카페에서 대화했다.",{mode:"story",profileName:"지수",userNames:["햄군"],knownNames:["영희","민수"]});
 assert.equal(result.target,"민수");assert.ok(!result.characters.includes("햄군"));
});
test("specific fantasy places and clothing are extracted rather than generic fallback descriptions",()=>{
 const result=selectImageScene("Latest completed chapter (current action):\n지수는 왕궁 연회장에 들어섰다. 지수는 붉은 비단 예복을 입었다.",{mode:"story",profileName:"지수",userNames:["햄군"]});
 assert.equal(result.location,"왕궁 연회장");assert.equal(result.outfit,"붉은 비단 예복");
 const missing=selectImageScene("Latest completed chapter (current action):\n지수는 조용히 눈을 떴다.",{mode:"story",profileName:"지수",userNames:["햄군"]});
 assert.equal(missing.location,undefined);assert.equal(missing.outfit,undefined);
});
test("the final image prompt uses the prepared location and clothing without appending the raw confirmation inputs",()=>{
 const brief=illustrationBrief.parse({title:"삽화",summary:"연회 장면",prompt:"A woman in a red silk evening dress.",styleProfile:"female",characterPresent:true,pose:"standing near a table",framing:"medium shot",sceneLocation:"The palace banquet hall",locationSource:"narrative"});
 const prompt=buildCharacterPrompt(brief,{kind:"illustration",context:"지수는 연회장에 있었다.",selection:{profileName:"지수",userNames:["햄군"],characters:["지수"],target:"지수",location:"왕궁 연회장",outfit:"붉은 비단 예복",confirmed:true}});
 assert.match(prompt,/red silk evening dress/);assert.match(prompt,/The palace banquet hall/);assert.doesNotMatch(prompt,/왕궁 연회장|붉은 비단 예복/);
});
