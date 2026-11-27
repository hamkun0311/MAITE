"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {CalendarDays,ChevronLeft,ChevronRight,Heart,LoaderCircle} from "lucide-react";
import {useAccount} from "./AccountProvider";
import {jsonApi,invalidateApiReads} from "@/lib/platform/commerce";
import {koreaDay} from "@/lib/account/policy";
import {hasRewardClaim,passForDay,rewardsCalendarPath,type RewardCalendar} from "@/lib/account/rewards";
import {useScreenLoading} from "./ScreenLoading";
import HeartText from "./HeartText";
const dateKey=(year:number,month:number,day:number)=>`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
export default function RewardsScreen(){
 const {user,refresh}=useAccount();const [month,setMonth]=useState(()=>koreaDay().slice(0,7)+"-01"),[selected,setSelected]=useState(koreaDay);
 const [data,setData]=useState<RewardCalendar>(),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[notice,setNotice]=useState("");
 useScreenLoading(!!user&&(loading||(!data&&!notice)));
 const [year,m]=month.split("-").map(Number);const days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=new Date(Date.UTC(year,m-1,1)).getUTCDay();
 async function load(){return await jsonApi(rewardsCalendarPath(month)) as RewardCalendar;}
 useEffect(()=>{let alive=true;setData(undefined);setNotice("");if(!user)return;setLoading(true);void load().then(value=>{if(alive)setData(value);}).catch(error=>{if(alive)setNotice(error.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[month,user?.id]);
 const today=data?.today??koreaDay();
 const pass=passForDay(data,selected);
 const received=(day:string,kind:"attendance"|"pass")=>hasRewardClaim(data,day,kind);
 const attendance=new Date(selected+"T00:00:00Z").getUTCDay()===0?15:5;
 function move(delta:number){const next=new Date(Date.UTC(year,m-1+delta,1));const value=dateKey(next.getUTCFullYear(),next.getUTCMonth(),1);setMonth(value);setSelected(value.slice(0,7)===today.slice(0,7)?today:value);}
 async function claim(kind:"attendance"|"pass"){
  if(busy||!data)return;setBusy(true);setNotice("");const requestedMonth=month;
  try{const result=await jsonApi("/api/rewards",{kind,day:selected});invalidateApiReads();const next=await load();if(requestedMonth===month)setData(next);await refresh();setNotice(result.claimed?`${result.claimed}하트를 받았어요.`:"이미 받은 보상이에요.");}
  catch(error){setNotice(error instanceof Error?error.message:"보상을 받지 못했습니다.");}finally{setBusy(false);}
 }
 return <main className="native-page rewards-page"><Link className="native-back" href="/ideal/mypage"><ChevronLeft size={18}/>내 정보</Link><div className="native-page-title"><div><h1>출석·패스 보상</h1><p><HeartText text="오늘의 하트를 받아보세요."/></p></div><CalendarDays size={26}/></div>
 <section className="reward-calendar" aria-label="보상 달력"><div className="reward-month"><button type="button" disabled={busy} aria-label="이전 달" onClick={()=>move(-1)}><ChevronLeft size={20}/></button><h2>{year}년 {m}월</h2><button type="button" disabled={busy} aria-label="다음 달" onClick={()=>move(1)}><ChevronRight size={20}/></button></div>
 <div className="reward-weekdays">{["일","월","화","수","목","금","토"].map(day=><span key={day}>{day}</span>)}</div><div className="reward-days">{Array.from({length:offset},(_,index)=><span key={`empty-${index}`}/>)}{Array.from({length:days},(_,index)=>{
 const day=index+1,key=dateKey(year,m-1,day),amount=(offset+index)%7===0?15:5;
 return <button key={key} type="button" disabled={busy||loading} aria-label={`${key}${key===today?" 오늘":""}`} aria-pressed={selected===key} className={`${key===today?"is-today ":""}${selected===key?"is-selected":""}`} onClick={()=>setSelected(key)}><span>{day}</span>{key===today?<small><Heart size={10}/>{amount}</small>:received(key,"attendance")?<small>수령</small>:<small>&nbsp;</small>}{received(key,"pass")&&<i aria-label="패스 수령 완료"/>}</button>;
 })}</div></section>
 <section className="reward-claims" aria-label="선택 날짜 보상"><h2>{selected} {selected===today?"· 오늘":""}</h2><div className="reward-claim-row"><div><strong>출석 보상</strong><span><Heart size={15} role="img" aria-label="하트"/> {attendance}</span></div><button className="native-primary" disabled={busy||loading||!data||selected!==today||received(selected,"attendance")} onClick={()=>void claim("attendance")}>{busy?<LoaderCircle size={16} className="spin"/>:received(selected,"attendance")?"수령 완료":selected<today?"수령 불가":selected>today?"아직 받을 수 없어요":"보상 받기"}</button></div>
 {pass&&<div className="reward-claim-row"><div><strong>패스 보상</strong><span><Heart size={15} role="img" aria-label="하트"/> {pass.daily_hearts}</span></div><button className="native-primary" disabled={busy||loading||!data||selected>today||received(selected,"pass")} onClick={()=>void claim("pass")}>{busy?<LoaderCircle size={16} className="spin"/>:received(selected,"pass")?"수령 완료":selected>today?"아직 받을 수 없어요":"패스 보상 받기"}</button></div>}
 <p>출석 보상은 당일에만 받을 수 있어요. 패스 보상은 구매한 유효기간의 지난 날짜도 선택해 받을 수 있어요.</p>{notice&&<p role="status"><HeartText text={notice}/></p>}</section></main>;
}
