"use client";
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import writingArtwork from "./assets/writing-loading.png";

type Register=()=>()=>void;
const Context=createContext<Register|undefined>(undefined);

export function useScreenLoading(active:boolean){
  const register=useContext(Context);
  useEffect(()=>{if(active)return register?.();},[active,register]);
}

function LoadingPopup(){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  return <dialog ref={dialog} className="generation-loading screen-loading" aria-label="불러오는 중" tabIndex={-1} onCancel={event=>event.preventDefault()}>
    <div className="generation-writing" aria-hidden="true"><img src={typeof writingArtwork==="string"?writingArtwork:writingArtwork.src} alt=""/><span className="generation-writing-dots"><i/><i/><i/></span></div>
    <p role="status" aria-live="polite">불러오는 중…</p>
  </dialog>;
}

export default function ScreenLoadingProvider({children}:{children:ReactNode}){
  const [requests,setRequests]=useState<Set<symbol>>(()=>new Set());
  const [visible,setVisible]=useState(false),busy=requests.size>0;
  useEffect(()=>{if(!busy){setVisible(false);return;}const timer=setTimeout(()=>setVisible(true),150);return()=>clearTimeout(timer);},[busy]);
  const register=useCallback(()=>{
    const id=Symbol("screen-loading");
    setRequests(previous=>new Set(previous).add(id));
    return()=>setRequests(previous=>{const next=new Set(previous);next.delete(id);return next;});
  },[]);
  return <Context.Provider value={register}>{children}{busy&&visible&&<LoadingPopup/>}</Context.Provider>;
}
