import {promptTable} from "../prompt-table.ts";
import type {Timeline} from "../chat/timeline.ts";

export const promptTableInstructions="Tables are lossless: columns define field names and every row supplies their ordered values, including source, actor, target, knowledge scope and evidence. Read all rows as ordinary objects; a table is not an outline or permission to omit facts.";
export function novelTimelineContext(timeline:Timeline){
 return {...timeline,
  participants:promptTable(timeline.participants,["id","name"]),
  ...(timeline.canon?{canon:promptTable(timeline.canon,["id","source","sourceId","subjectId","objectId","key","kind","status","visibility","text","evidence"])}:{}),
 };
}
export const sourceContext=(sources:{id:string;text:string}[])=>promptTable(sources,["id","text"]);
