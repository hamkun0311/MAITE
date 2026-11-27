"use client";
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import writingArtwork from "./assets/writing-loading.png";

type Register=(message?:string)=>()=>void;
const Context=createContext<Register|undefined>(undefined);

export function useScreenLoading(active:boolean,message?:string){
  const register=useContext(Context);
  useEffect(()=>{if(active)return register?.(message);},[active,register,message]);
}

function LoadingPopup({message}:{message?:string}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  return <dialog ref={dialog} className="screen-loading" aria-label={message??"불러오는 중"} tabIndex={-1} onCancel={event=>event.preventDefault()}>
    <div className="screen-loading-card">
      <div className="generation-writing" aria-hidden="true"><img src={typeof writingArtwork==="string"?writingArtwork:writingArtwork.src} alt=""/><span className="generation-writing-dots"><i/><i/><i/></span></div>
      <p role="status" aria-live="polite">{message??"불러오는 중…"}</p>
    </div>
  </dialog>;
}

export default function ScreenLoadingProvider({children}:{children:ReactNode}){
  const [requests,setRequests]=useState<Map<symbol,string|undefined>>(()=>new Map());
  const [visible,setVisible]=useState(false),busy=requests.size>0;
  useEffect(()=>{if(!busy){setVisible(false);return;}const timer=setTimeout(()=>setVisible(true),150);return()=>clearTimeout(timer);},[busy]);
  const register=useCallback((message?:string)=>{
    const id=Symbol("screen-loading");
    setRequests(previous=>new Map(previous).set(id,message));
    return()=>setRequests(previous=>{const next=new Map(previous);next.delete(id);return next;});
  },[]);
  const message=Array.from(requests.values()).reverse().find(Boolean);
  return <Context.Provider value={register}>{children}{busy&&visible&&<LoadingPopup message={message}/>}</Context.Provider>;
}
