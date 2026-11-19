"use client";
import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {notificationSync} from "@/lib/platform/notification-sync";
import {useAccount} from "./AccountProvider";

const EMPTY:Record<string,number>={};
const Context=createContext<Record<string,number>>(EMPTY);
export const useCheckinInbox=()=>useContext(Context);
export default function CheckinInbox({children}:{children:ReactNode}){
 const {user}=useAccount();
 const [state,setState]=useState<{owner:string;unread:Record<string,number>}>();
 useEffect(()=>{
  if(!user)return;
  const owner=user.id;notificationSync.activate(owner);
  const update=()=>{
   const unread=notificationSync.snapshot(owner)?.unread;
   if(!unread||typeof unread!=="object")return;
   setState(previous=>previous?.owner===owner&&Object.keys(previous.unread).length===Object.keys(unread).length&&Object.keys(unread).every(key=>previous.unread[key]===unread[key])?previous:{owner,unread});
  };
  const unsubscribe=notificationSync.subscribe(update);update();return unsubscribe;
 },[user?.id]);
 return <Context.Provider value={state?.owner===user?.id?state?.unread??EMPTY:EMPTY}>{children}</Context.Provider>;
}
