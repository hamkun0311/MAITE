"use client";
import {useEffect,useRef} from "react";
import {useRouter} from "next/navigation";
import {isNative} from "@/lib/platform/native";
import {activateLocalCheckins,syncLocalCheckins,unregisterPush,updateCheckinStatus} from "@/lib/platform/push";
import {useAccount} from "./AccountProvider";
import {useStudioSession} from "./CharacterStudio";
export default function PushBridge(){
 const {user}=useAccount(),{loadDocument}=useStudioSession(),router=useRouter();
 const current=useRef({loadDocument,router});current.current={loadDocument,router};
 useEffect(()=>{
  if(!user)return;
  activateLocalCheckins(user.id);
  let active=true,deadline:ReturnType<typeof setTimeout>|undefined;const listeners:{remove:()=>Promise<void>}[]=[];
  const sync=()=>{if(active)void syncLocalCheckins(user.id).then(dueAt=>{
   if(!active)return;clearTimeout(deadline);
   if(dueAt)deadline=setTimeout(sync,Math.max(100,Date.parse(dueAt)-Date.now()));
  }).catch(()=>{if(active)updateCheckinStatus(user.id,"안부 예약 연결을 확인하지 못했어요. 잠시 후 다시 확인해요.");});};
  sync();const timer=setInterval(sync,60000);
  const events=["maite-foreground","maite-library-saved","maite-library-deleted","maite-notification-settings","focus"];
  events.forEach(event=>window.addEventListener(event,sync));
  if(isNative())void import("@capacitor/local-notifications").then(async({LocalNotifications})=>{
   const tap=await LocalNotifications.addListener("localNotificationActionPerformed",event=>{
    const data=event.notification.extra;
    if(!active||data?.userId!==user.id||!/^[-a-f0-9]{36}$/i.test(data?.documentId||""))return;
    void syncLocalCheckins(user.id).catch(()=>undefined).then(()=>current.current.loadDocument(data.documentId)).then(()=>{if(active)current.current.router.push("/ideal/chat");}).catch(()=>undefined);
   });
   const received=await LocalNotifications.addListener("localNotificationReceived",()=>{sync();window.dispatchEvent(new Event("maite-checkins-refresh"));});
   if(!active){await tap.remove();await received.remove();}else listeners.push(tap,received);
  }).catch(()=>undefined);
  return()=>{active=false;clearInterval(timer);clearTimeout(deadline);events.forEach(event=>window.removeEventListener(event,sync));listeners.forEach(listener=>void listener.remove());void unregisterPush().catch(()=>undefined);};
 },[user?.id]);
 return null;
}
