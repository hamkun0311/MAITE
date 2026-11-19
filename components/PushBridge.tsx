"use client";
import {useEffect,useRef} from "react";
import {useRouter} from "next/navigation";
import {isNative} from "@/lib/platform/native";
import {activateLocalCheckins,syncLocalCheckins,unregisterPush,updateCheckinStatus} from "@/lib/platform/push";
import {useAccount} from "./AccountProvider";
import {useStudioSession} from "./CharacterStudio";
import {notificationSync} from "@/lib/platform/notification-sync";
export default function PushBridge(){
 const {user,account}=useAccount(),{loadDocument}=useStudioSession(),router=useRouter();
 const nickname=account?.profile?.display_name;
 const current=useRef({loadDocument,router,nickname});current.current={loadDocument,router,nickname};
 useEffect(()=>{
  if(!user)return;
  activateLocalCheckins(user.id);
  let active=true,deadline:ReturnType<typeof setTimeout>|undefined,debounce:ReturnType<typeof setTimeout>|undefined;const listeners:{remove:()=>Promise<void>}[]=[];
  const sync=()=>{if(active)void syncLocalCheckins(user.id,current.current.nickname).then(dueAt=>{
   if(!active)return;clearTimeout(deadline);
   if(dueAt)deadline=setTimeout(sync,Math.max(100,Date.parse(dueAt)-Date.now()));
  }).catch(()=>{if(active)updateCheckinStatus(user.id,"안부 예약 연결을 확인하지 못했어요. 잠시 후 다시 확인해요.");});};
  sync();const timer=setInterval(()=>{if(!document.hidden)sync();},60000);
  const queueSync=(event:Event)=>{
   if(!["focus","maite-foreground","visibilitychange"].includes(event.type))notificationSync.invalidate(user.id);
   clearTimeout(debounce);debounce=setTimeout(sync,150);
  };
  const visible=()=>{if(!document.hidden)queueSync(new Event("visibilitychange"));};
  const events=["maite-foreground","maite-library-saved","maite-library-deleted","maite-notification-settings","maite-checkins-refresh","maite-checkins-read","focus"];
  events.forEach(event=>window.addEventListener(event,queueSync));
  document.addEventListener("visibilitychange",visible);
  if(isNative())void import("@capacitor/local-notifications").then(async({LocalNotifications})=>{
   const tap=await LocalNotifications.addListener("localNotificationActionPerformed",event=>{
    const data=event.notification.extra;
    if(!active||data?.userId!==user.id||!/^[-a-f0-9]{36}$/i.test(data?.documentId||""))return;
    void syncLocalCheckins(user.id,current.current.nickname).catch(()=>undefined).then(()=>current.current.loadDocument(data.documentId)).then(()=>{if(active)current.current.router.push("/ideal/chat");}).catch(()=>undefined);
   });
   const received=await LocalNotifications.addListener("localNotificationReceived",()=>{sync();window.dispatchEvent(new Event("maite-checkins-refresh"));});
   if(!active){await tap.remove();await received.remove();}else listeners.push(tap,received);
  }).catch(()=>undefined);
  return()=>{active=false;clearInterval(timer);clearTimeout(deadline);clearTimeout(debounce);events.forEach(event=>window.removeEventListener(event,queueSync));document.removeEventListener("visibilitychange",visible);listeners.forEach(listener=>void listener.remove());void unregisterPush().catch(()=>undefined);};
 },[user?.id]);
 return null;
}
