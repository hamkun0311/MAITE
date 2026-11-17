"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Heart, Trash2, X } from "lucide-react";

type Confirmation = { title: string; description: string; lines?: { label: string; value: string }[]; confirmLabel?: string; danger?: boolean };
const Context = createContext<(value: Confirmation) => Promise<boolean>>(async () => false);
export const useActionConfirm = () => useContext(Context);
export default function ActionConfirmProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Confirmation>();
  const resolve = useRef<((result: boolean) => void) | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (value) dialog.current?.showModal(); }, [value]);
  useEffect(() => () => { resolve.current?.(false); }, []);
  function finish(result: boolean) { dialog.current?.close(); setValue(undefined); const done = resolve.current; resolve.current = undefined; done?.(result); }
  async function confirm(next: Confirmation) {
    if (resolve.current) return false;
    return new Promise<boolean>(done => { resolve.current = done; setValue(next); });
  }
  return <Context.Provider value={confirm}>{children}{value && <dialog ref={dialog} className={`action-confirm${value.danger ? " is-danger" : ""}`} aria-labelledby="action-confirm-title" aria-describedby="action-confirm-description" onCancel={event => { event.preventDefault(); finish(false); }}>
    <div className="sheet-handle"/><button type="button" className="sheet-close" aria-label="확인 팝업 닫기" onClick={() => finish(false)}><X size={20}/></button>
    <div className="confirm-symbol">{value.danger ? <Trash2 size={25}/> : <Heart size={25}/>}</div><h2 id="action-confirm-title">{value.title}</h2><p id="action-confirm-description">{value.description}</p>
    {value.lines && <dl>{value.lines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl>}
    <div className="confirm-actions"><button type="button" onClick={() => finish(false)}>취소</button><button type="button" className="native-primary" onClick={() => finish(true)}>{value.confirmLabel || "확인"}</button></div>
  </dialog>}</Context.Provider>;
}
