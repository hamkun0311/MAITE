"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {BookOpen,ChevronLeft,ChevronRight,Library} from "lucide-react";
import {useAccount} from "./AccountProvider";
import {useStudioSession} from "./CharacterStudio";
import {libraryNovels} from "@/lib/account/library";
import {readChapter,saveChapter} from "@/lib/account/reading-progress";
import {jsonApi} from "@/lib/platform/commerce";
import {usePathname} from "next/navigation";

type Chapter={id:string;kind:string;title:string;chapter?:number;novel?:{id:string;title:string;chapters:number}};
export function BookshelfScreen(){
 const {account,user}=useAccount();const {flushSave}=useStudioSession();
 const [owned,setOwned]=useState<Chapter[]>([]),[error,setError]=useState("");
 useEffect(()=>{if(!user)return;let alive=true;void flushSave().catch(()=>{});void jsonApi("/api/store").then(data=>{if(alive)setOwned(data.listings.filter((row:Chapter)=>row.kind==="chapter"&&data.owned.includes(row.id)));}).catch(()=>{if(alive)setError("구매한 소설을 불러오지 못했습니다.");});return()=>{alive=false;};},[user?.id]);
 const groups=new Map<string,Chapter>();for(const row of owned)groups.set(row.novel?.id??row.id,row);
 const novels=libraryNovels(account?.documents??[]);
 return <main className="native-page bookshelf-page"><div className="native-page-title"><div><h1>서고</h1><p>마지막으로 읽던 이야기부터 이어보세요.</p></div><Library size={25}/></div><section className="native-session-list" aria-label="소유한 소설">
 {novels.map(novel=><Link key={novel.id} href={`/ideal/novels/${novel.id}`}><BookOpen size={26}/><div><h3>{novel.title}</h3><p>내가 만든 소설 · {novel.chapter}편</p></div><ChevronRight size={18}/></Link>)}
 {[...groups].map(([id,novel])=><Link key={`purchased-${id}`} href={`/ideal/library/${id}`}><BookOpen size={26}/><div><h3>{novel.novel?.title??novel.title}</h3><p>구매한 소설</p></div><ChevronRight size={18}/></Link>)}
 </section>{!novels.length&&!groups.size&&<div className="native-empty"><BookOpen size={38}/><p>아직 소유한 소설이 없어요.</p></div>}{error&&<p role="status">{error}</p>}</main>;
}
export function PurchasedNovelScreen(){
 const path=usePathname(),id=path.split("/").at(-1)!;const {account}=useAccount();
 const [chapters,setChapters]=useState<Chapter[]>([]),[selected,setSelected]=useState(1),[text,setText]=useState(""),[error,setError]=useState(""),[loadedId,setLoadedId]=useState("");
 useEffect(()=>{let alive=true;setChapters([]);setText("");setError("");void jsonApi("/api/store").then(data=>{
  if(!alive)return;const rows:Chapter[]=data.listings.filter((row:Chapter)=>row.kind==="chapter"&&(row.novel?.id??row.id)===id&&data.owned.includes(row.id)).sort((a:Chapter,b:Chapter)=>(a.chapter??1)-(b.chapter??1));
  if(!rows.length)throw new Error("구매한 회차가 없습니다.");setChapters(rows);setLoadedId(id);const saved=readChapter(account?.userId??"demo",`purchased:${id}`);setSelected(rows.find(row=>row.chapter===saved)?.chapter??rows[0].chapter??1);
 }).catch(failure=>{if(alive)setError(failure.message);});return()=>{alive=false;};},[id,account?.userId]);
 const row=loadedId===id?chapters.find(row=>(row.chapter??1)===selected):undefined;
 useEffect(()=>{if(!row)return;let alive=true;setText("");setError("");saveChapter(account?.userId??"demo",`purchased:${id}`,selected);void jsonApi(`/api/store?id=${row.id}`).then(data=>{if(alive)setText(data.content.text);}).catch(()=>{if(alive)setError("이 회차를 불러오지 못했습니다.");});return()=>{alive=false;};},[row?.id,selected,account?.userId,id]);
 const index=chapters.findIndex(row=>(row.chapter??1)===selected);
 return <main className="native-page account-page novel-detail-page purchased-novel-page"><Link className="native-back native-library-back" href="/ideal/library"><ChevronLeft size={18}/>서고</Link><h1>{row?.novel?.title??row?.title??"구매한 소설"}</h1><div className="novel-reader-shell"><div className="story-page-navigation novel-side-navigation"><button aria-label="이전 이야기 보기" disabled={index<=0} onClick={()=>setSelected(chapters[index-1].chapter??1)}><ChevronLeft/></button><button aria-label="다음 이야기 보기" disabled={index<0||index===chapters.length-1} onClick={()=>setSelected(chapters[index+1].chapter??1)}><ChevronRight/></button></div><article className="novel-reader story-pages saved-novel-reader"><div key={`${id}-${selected}`} className="story-page novel-text-scroll" tabIndex={0} aria-label="소설 본문"><h3>이야기 #{selected}</h3><p>{text||(!error?"이야기를 불러오고 있어요.":"")}</p></div></article></div>{error&&<p role="status">{error}</p>}</main>;
}
