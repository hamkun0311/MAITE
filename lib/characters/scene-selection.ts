import {sceneAttributes} from "../chat/visual-scene.ts";
import type {ImageSceneSelection} from "./visual.ts";
const absent=/^(?:은|는|이|가)?\s*(?:이곳에\s*|여기에\s*|곁에\s*)?(?:없|부재|떠났|자리를\s*비웠|오지\s*않|나타나지\s*않)/;
function present(name:string,text:string){
 const line=text.split(/[.!?。\n]/).filter(line=>{
  const index=line.indexOf(name);if(index<0)return false;
  const before=line.slice(Math.max(0,index-20),index),after=line.slice(index+name.length);
  return !/회상|기억 속|떠올리|생각하며/.test(before)&&!/떠올|회상|생각했|그리워/.test(after.slice(0,35))&&!/내일|나중에|갈 예정/.test(line);
 }).at(-1);
 return !!line&&!absent.test(line.slice(line.indexOf(name)+name.length));
}
export function selectImageScene(context:string,options:{mode:"chat"|"story";profileName:string;userNames:string[];knownNames?:string[]}):ImageSceneSelection{
 const marker="Latest completed chapter (current action):\n";
 const source=options.mode==="story"?context.split(marker).at(-1)!:[...context.matchAll(/(?:^|\n)(?:사용자|캐릭터): ([\s\S]*?)(?=\n\n(?:사용자|캐릭터): |$)/g)].map(match=>match[1]).join("\n");
 const userNames=[...new Set(options.userNames.filter(Boolean))].slice(0,4);
 const excluded=(name:string)=>["사용자","당신","화자","나",...userNames].some(user=>name===user||user.endsWith(` ${name}`));
 const roles=source.match(/(?:점원|직원|경비원|낯선 남자|낯선 여자|수호기사|기사|국왕|왕비|공주|의사|선생님)(?=은|는|이|가|와|과|을|를|[\s,.!?])/g)??[];
 const candidates=[...new Set([options.profileName,...(options.knownNames??[]),...roles].map(name=>name.trim().slice(0,80)).filter(Boolean))].filter(name=>!excluded(name));
 const characters=candidates.filter(name=>present(name,source));
 const explicitlyAbsent=source.includes(options.profileName)&&!present(options.profileName,source);
 if(options.mode==="chat"&&!explicitlyAbsent&&!characters.includes(options.profileName)&&!excluded(options.profileName))characters.unshift(options.profileName);
 const score=(name:string)=>Math.max(0,...source.split(/[.!?。\n]/).map((line,index)=>line.includes(name)?index+(userNames.some(user=>line.includes(user))||/당신|나는|나와|내게|나에게/.test(line)?100:0)+(/대화|마주|말했|다가|건넸/.test(line)?20:0):0));
 const target=characters.includes(options.profileName)?options.profileName:[...characters].sort((a,b)=>score(b)-score(a))[0];
 const attributes=sceneAttributes(source);
 let local:{location?:string;outfit?:string}|undefined;
 if(options.mode==="chat"&&context.startsWith("Latest confirmed visual scene"))try{local=JSON.parse(context.split("\n")[1]);}catch{}
 // An absent profile's wardrobe belongs to that profile, not the counterpart.
 let outfit=target===options.profileName?local?.outfit:undefined;
 if(target&&!outfit){
  for(const sentence of source.split(/[.!?。\n]/).filter(line=>line.includes(target))){let owned=sentence.slice(sentence.indexOf(target)+target.length);for(const name of [...userNames,...characters.filter(name=>name!==target)]){const index=owned.indexOf(name);if(index>=0)owned=owned.slice(0,index);}outfit=sceneAttributes(owned).outfit??outfit;}
  if(!outfit&&target===options.profileName&&characters.length===1&&!userNames.some(name=>source.includes(name))&&!/당신|나는|내가|나의/.test(source))outfit=attributes.outfit;
 }
 const location=(target===options.profileName?(local?.location??attributes.location):attributes.location)?.replace(/^[가-힣]+(?:와|과)\s+/,"");
 return {location,outfit,characters:characters.slice(0,8),...(target?{target}:{}),profileName:options.profileName,userNames};
}
