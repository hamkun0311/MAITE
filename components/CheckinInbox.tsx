"use client";
import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {apiFetch} from "@/lib/platform/api";
import {useAccount} from "./AccountProvider";

const Context=createContext<Record<string,number>>({});
export const useCheckinInbox=()=>useContext(Context);
export default function CheckinInbox({children}:{children:ReactNode}){
 const {user}=useAccount();
 const [unread,setUnread]=useState<Record<string,number>>({});
 useEffect(()=>{
  if(!user)return;
  let active=true,running=false,again=false;
  const refresh=async()=>{
   if(running){again=true;return;}running=true;
   try{
    const response=await apiFetch("/api/notifications?inbox=1",{signal:AbortSignal.timeout(8000)});
    const data=await response.json();
    if(active&&response.ok&&data.unread&&typeof data.unread==="object")setUnread(data.unread);
   }catch{/* Keep existing unread markers when offline. */}
   finally{running=false;if(active&&again){again=false;void refresh();}}
  };
  const wake=()=>{if(!document.hidden)void refresh();};
  void refresh();const timer=setInterval(wake,60000);
  const events=["maite-checkins-refresh","maite-checkins-read","maite-foreground","maite-library-deleted","focus"];
  events.forEach(event=>window.addEventListener(event,wake));document.addEventListener("visibilitychange",wake);
  return()=>{active=false;clearInterval(timer);events.forEach(event=>window.removeEventListener(event,wake));document.removeEventListener("visibilitychange",wake);};
 },[user?.id]);
 return <Context.Provider value={unread}>{children}</Context.Provider>;
}
