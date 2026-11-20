"use client";
import { useEffect, useState } from "react";
import { Bell, Moon } from "lucide-react";
import { jsonApi } from "@/lib/platform/commerce";
import { registerPush, cancelLocalReservation, localCheckinStatus } from "@/lib/platform/push";
import { isNative } from "@/lib/platform/native";
import { useAccount } from "./AccountProvider";
import {CHECKIN_DELAY_LABEL} from "@/lib/notifications/timing";
import {useScreenLoading} from "./ScreenLoading";
type Settings={pushEnabled:boolean;quietHours:boolean;available:boolean};
export default function NotificationSettings(){
 const {user}=useAccount();const [settings,setSettings]=useState<Settings>();const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const [status,setStatus]=useState("");
 const [retry,setRetry]=useState(0),[loading,setLoading]=useState(true);
 useScreenLoading(loading&&!!user);
 const native=isNative();
 useEffect(()=>{if(!user)return;const refresh=()=>setStatus(localCheckinStatus(user.id));refresh();window.addEventListener("maite-checkin-status",refresh);return()=>window.removeEventListener("maite-checkin-status",refresh);},[user?.id]);
 useEffect(()=>{
  let active=true;setSettings(undefined);setError("");setLoading(true);
  if(user)void jsonApi("/api/notifications").then(data=>{if(active)setSettings(data);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"안부 설정을 불러오지 못했습니다.");}).finally(()=>{if(active)setLoading(false);});
  else setLoading(false);
  return()=>{active=false;};
 },[user?.id,retry]);
 async function change(key:"pushEnabled"|"quietHours"){
  if(!settings||busy)return;setBusy(true);setError("");
  const next={...settings,[key]:!settings[key]};
  try{
   if(native&&key==="pushEnabled"&&next.pushEnabled)await registerPush(true);
   await jsonApi("/api/notifications",{action:"settings",pushEnabled:next.pushEnabled,quietHours:next.quietHours});
   setSettings(next);
   if(key==="pushEnabled"&&!next.pushEnabled)await cancelLocalReservation();
   window.dispatchEvent(new Event("maite-notification-settings"));
  }catch(e){setError(e instanceof Error?e.message:"알림 설정을 저장하지 못했습니다.");}finally{setBusy(false);}
 }
 return <section className="native-settings-list notification-settings"><h2>알림 설정</h2>
  <div className="notification-setting"><span><Bell size={18}/>{native?"앱 알림":"안부 대화"}</span><button type="button" role="switch" aria-label={native?"앱 알림":"안부 대화"} aria-checked={settings?.pushEnabled??false} disabled={!settings?.available||busy} onClick={()=>void change("pushEnabled")}><i/></button></div>
  <div className="notification-setting"><span><Moon size={18}/>야간 알림 제한</span><button type="button" role="switch" aria-label="야간 알림 제한" aria-checked={settings?.quietHours??true} disabled={!settings||busy} onClick={()=>void change("quietHours")}><i/></button></div>
  <p>안부 대기 시간: {CHECKIN_DELAY_LABEL}. 캐릭터마다 마지막 대화 이후 하루 한 번 보내며, 해당 캐릭터에게 답장이 없으면 다시 보내지 않아요.</p><p>야간 제한: 한국시간 22:00~10:00 · {native?"이 Android 기기에 알림을 예약해요.":"브라우저 알림 권한 없이 안부 대화를 켤 수 있어요. 웹에서는 화면을 열어 둔 동안 안부를 확인할 수 있어요. 앱이 닫혀 있을 때의 알림은 Android 앱에서 제공해요."}</p>
  {settings?.available&&<p className="checkin-reservation-status">{status}</p>}
  {!loading&&(!settings?.available||error)&&<p role="status">{error||"안부 설정을 사용할 수 없습니다."}</p>}
  {!loading&&!settings?.available&&<button type="button" className="native-outline" disabled={!user} onClick={()=>setRetry(value=>value+1)}>설정 다시 불러오기</button>}
 </section>;
}
